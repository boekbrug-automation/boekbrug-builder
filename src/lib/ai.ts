// ─────────────────────────────────────────────────────────
// src/lib/ai.ts
// [BoekBrug v1.2] — BOEK-018 — AI Layer
// Central Claude API client. Import from here only.
// Do not call Claude API directly from any other file.
//
// ── SERVER-ONLY, EN NU OOK AFGEDWONGEN ──
// De regel hierboven stond er al, maar niets hield hem tegen. Twee 'use client'-componenten
// importeerden dit bestand toch, en het gevolg was onzichtbaar in plaats van luid:
//
//   · AccountantHome riep composeDraftEmail aan vanuit de browser. callClaude doet daar
//     fetch('https://api.anthropic.com') met process.env.ANTHROPIC_API_KEY — een variabele die
//     in een clientbundel niet bestaat (Next vervangt alleen NEXT_PUBLIC_*). De sleutel was dus
//     leeg, en Anthropic staat sowieso geen browser-origin toe. De AI-assistent van de
//     boekhouder kón nooit werken en zei "Probeer het opnieuw", wat niets oploste.
//   · ZzpDashboard importeerde generateInvoiceFromPrompt voor een paneel dat al in commentaar
//     stond — dus onbereikbare code, waarvoor élke bezoeker wel de hele AI-laag downloadde.
//
// Er lekte geen sleutel: niet-publieke variabelen blijven een runtime-lookup en zijn in de
// browser undefined; er stond geen enkele sk-ant-waarde in de bundel. Maar api.anthropic.com en
// alle systeemprompts stonden er wél in.
//
// Vandaar de grendel hieronder. Wie dit bestand voortaan vanuit de browser laadt, krijgt
// meteen een luide fout in plaats van een scherm dat stil niets doet. Wat de browser nodig
// heeft, hoort via een route te lopen; zie /api/ai/draft-email voor de vorm.
//
// NIET het `server-only`-pakket, hoewel de Next-documentatie dat aanraadt (data-security.md
// §"Preventing client-side execution of server-only code"), en ik het eerst zo had gedaan. Dat
// pakket gooit bij ELKE import buiten een react-server-omgeving, en dus ook onder
// `tsx --test` — waarmee deze repo zeven testbestanden draait die pure functies uit dit
// bestand halen (rescue-logica, btw-sommen, confidence-banden). Het brak ze alle zeven. De
// bouwfout die het oplevert is netter dan een runtime-fout, maar niet ten koste van de tests
// die de rekenkern bewaken. Deze controle doet hetzelfde werk waar het telt en is onzichtbaar
// in Node.
if (typeof window !== 'undefined') {
  throw new Error(
    '[AI] src/lib/ai.ts is serverkant. Importeer het niet vanuit een client component — ' +
    'de Claude-sleutel bestaat daar niet en api.anthropic.com weigert een browser-origin. ' +
    'Roep het aan via een API-route, zoals /api/ai/draft-email dat doet.'
  );
}
//
// Usage examples:
//
// BOEK-011 Email Integration:
//   import { classifyDocument, verifyInvoiceFromPdf } from '@/lib/ai';
//
// BOEK-015 Onboarding:
//   import { translateToNL } from '@/lib/ai';
//
// BOEK-028 Accountant Dashboard:
//   import { composeDraftEmail } from '@/lib/ai';
//
// BOEK-029 ZZP Dashboard:
//   import { classifyExpense, generateInvoiceFromPrompt } from '@/lib/ai';
//
// BOEK-016 Bank Matching (v2.0):
//   import { matchTransaction } from '@/lib/ai';
// ─────────────────────────────────────────────────────────
//
// Rule: AI prepares + presents. Human confirms. System executes.
// ─────────────────────────────────────────────────────────

// [COST-GUARD] The global daily spend fuse. Every path to Anthropic goes through
// one of the three transports below, and each of them reserves budget first —
// so there is no way to reach the paid API that skips the ceiling. See
// src/lib/ai-budget.ts for why a GLOBAL ceiling and not a better per-user quota.
import { reserveAiBudget, settleAiBudget, TOKEN_ESTIMATE, AI_BUDGET_EXHAUSTED_ERROR, isAiBudgetError } from './ai-budget'
import { isTaxKind, isTaxOfficeName, type TaxKind } from "./tax-letter";

// [BOEK-018] constants — May 2026
// [MODEL-CONFIG] The OCR/classification model is ENV-CONFIGURABLE with a PROVEN default. A previous
// hard-coded switch to 'claude-sonnet-4-5-20251001' returned HTTP 404 (that exact id is not
// available on this account), which silently broke EVERY invoice classification — no invoice could
// be read or imported. The lesson: never hard-code an unverified model id. The default is the Haiku
// model this app has always run on successfully; to try a smarter model (e.g. a valid Sonnet), set
// CLAUDE_MODEL in the environment — and if that id is unavailable, just clear the env var to fall
// straight back to the working Haiku default, with NO code change or deploy needed.
//
// De waarde en de terugvalregel staan sinds [MODEL-CONFIG] in ai-model.ts, omdat de les hierboven
// een tweede keer werd overtreden: de herleesroute zette er zijn eigen model-id naast en ging langs
// dit hele mechanisme heen. Eén plek, met tests — zie de kop van dat bestand.
import { DEFAULT_CLAUDE_MODEL, resolveModel } from './ai-model';
// [GEGROND] The independent witness on a money field — see amount-grounding.ts.
import { groundMoneyFields } from './amount-grounding';
// [STATIEGELD-GAT] The deposit line the reader dropped, found back on the paper — see statiegeld.ts.
import { detectDepositGap } from './statiegeld';
// [REGELS] The lines, grouped per rate and checked against both printed anchors.
import { splitFromLines } from './factuurregels';
// [VREEMDE-VALUTA] The euro assumption, made explicit and checkable.
import { foreignCurrencyHold } from './vreemde-valuta';
// [GEGROND-NAAM] The same independent witness, for the supplier NAME — the one field on an
// incoming invoice that had no check at all. See the header of that file for the read that
// showed why: a BALKIP invoice imported under a different company's name, amounts all correct.
import { groundVendorName } from './vendor-grounding';
// [LEVERANCIER-STAAT-IN-HET-LOGO] The one line between "the reader is sure" and "look again, and
// if it is still unsure, ask". Shared with the health verdict and the queue's own ⚠️ banner — see
// the comment on the constant itself.
import { LOW_CONFIDENCE } from './confidence';
// [E-FACTUUR] De cijfers die de leverancier zelf in machinevorm meestuurt — geen lezing, maar de
// factuur zelf. Sterker dan elke controle hierboven, want er zit geen interpretatie tussen.
import { extractEmbeddedInvoiceXmlDetailed, parseEInvoice, eInvoiceContradicts, isEInvoiceXmlMime, type EInvoiceFigures } from './e-invoice';
// [DOCCHECK] The sharper check on the same text — see document-verify.ts.
import { verifyDocument } from './document-verify';
// [EIGEN-FACTUUR] Is this "purchase invoice" the owner's OWN sales invoice? Asked inside the
// reader, one line before the receiver-identity backstop erases the evidence — see there.
import { looksLikeOwnDocument, matchesOwnInvoiceNumber, ownDocumentNotice } from './own-document';
// [ZELFFACTUUR] The printed word for "the customer issued this", independent of the model.
import { selfBilledWordInDocument } from './zelffacturering';
import { round2 } from './invoice-totals';
// [MIN-REGEL] What a reading means by a quantity and a price — a negative quantity is a credit
// line, not an unreadable one, and the minus may never sit in the price. See read-line.ts.
import { readQuantity, signInQuantity } from './read-line';
import { OCR_AMOUNTS_PROMPT, OCR_AMOUNTS_SYSTEM, parseOcrAmounts, ocrAmountCount, MIN_OCR_AMOUNTS } from './ocr-amounts';

/**
 * Het model waarmee deze app leest. Geëxporteerd zodat een route die een ANDER model wil proberen
 * (de handmatige herlezing) hier op terug kan vallen in plaats van zijn eigen standaard te kiezen.
 */
export const CLAUDE_MODEL = resolveModel(process.env.CLAUDE_MODEL, DEFAULT_CLAUDE_MODEL);
// [BOEK-011 double-check m.1] Output token budget for Claude responses.
// The invoice JSON has ~20 fields + nested field_confidence + a Dutch `reason`,
// and since [BTW-SPLIT] also a btw_breakdown array — at most three rate rows on
// a Dutch invoice, so a few dozen tokens.
// At 1000 a complex invoice (long vendor name, full breakdown, detailed reason)
// could TRUNCATE mid-JSON → safeParseJSON fails → FALLBACK → the invoice is
// silently classified "not an invoice" and lost. 2000 gives ample headroom;
// the extra output tokens are a few cents and only billed when actually used.
const MAX_TOKENS = 2000;
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// [STATEMENT-GUARD] An unmistakable statement-of-account filename — an OVERVIEW of MULTIPLE
// invoices (with a summed total), never a single bookable invoice. Booking such a document
// as one invoice double-counts the invoices it summarises. Narrow on purpose: it excludes
// "aanmaning"/"herinnering", which can be a single-invoice reminder that IS bookable.
export function isStatementFilename(filename: string): boolean {
  return /(rekening|saldo|debiteuren|betalings?)[-_ ]?overzicht|openstaande?[-_ ]?posten|overzicht[-_ ]?openstaande[-_ ]?facturen/i.test(filename || "");
}

// [REMINDER] A filename that unmistakably marks a payment REMINDER (not a fresh invoice). Used
// as a deterministic backstop over the model's own is_reminder read, so a reminder whose PDF
// the model booked as a plain invoice is still flagged for the human. Deliberately excludes
// bare "factuur"/"invoice". A reminder is a real (single) invoice, so we do NOT reject it — we
// only ensure it is FLAGGED so the human checks it isn't already booked (avoids double-count).
// [INCASSO-WOORDEN] De volledige Nederlandse escalatieladder, niet alleen de eerste twee treden.
// Nagelopen tegen deurwaarders-/incassobronnen; de keten is:
//
//   betalingsherinnering → aanmaning → sommatie → ingebrekestelling
//
// en daarnaast de WIK-brief (Wet Incassokosten), ook bekend als 14-dagenbrief, aanzegging of
// laatste sommatie: de wettelijk verplichte brief vóórdat incassokosten in rekening mogen worden
// gebracht. Al deze documenten hebben ÉÉN ding gemeen dat hier telt: ze gaan over een factuur die
// je al hoort te hebben. Ze zijn dus nooit een NIEUWE kost.
//
// Alleen "herinnering" en "aanmaning" stonden hier — dus een "sommatie.pdf" of een
// "ingebrekestelling.pdf" gleed langs deze backstop en kon als een gewone factuur landen.
export function isReminderFilename(filename: string): boolean {
  return /betalings?[-_ ]?herinnering|(^|[^a-z])herinnering|herinneringsnota|aanmaning|sommatie|ingebrekestelling|wik[-_ ]?brief|14[-_ ]?dagen[-_ ]?brief|aanzegging|incasso[-_ ]?brief|laatste[-_ ]?(waarschuwing|aanmaning|sommatie)|(^|[^a-z])reminder([^a-z]|$)|payment[-_ ]?reminder|final[-_ ]?notice|dunning/i.test(
    filename || "",
  );
}

// [STATEMENT-TEXT-GUARD] A CONTENT backstop over the model's own is_statement read. The reported
// bug is an "openstaande facturen" overview (e.g. from no-reply@exact.com) that the small model
// rejects (is_invoice=false) but WITHOUT setting the optional is_statement boolean, and whose
// filename is generic — so neither the is_statement guard nor isStatementFilename fires, and the
// vendor+amount rescue below then resurrects it as one bookable invoice (double-count). This reads
// the extracted PDF TEXT and recognises the overview SHAPE deterministically. Deliberately narrow:
// it requires PLURAL/overview vocabulary ("openstaande facturen/posten", "rekeningoverzicht",
// "saldo-overzicht") AND a confirming signal (a summed open balance OR multiple invoice rows), so
// a single-invoice "betalingsherinnering" — which the policy KEEPS (imported, flagged) — is never
// caught here. Pure + testable. Empty/scanned text → false (the model's read stands).
export function looksLikeStatementText(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  const overviewTitle =
    // [INCASSO-WOORDEN] debiteuren-/betalingsoverzicht meegenomen: zelfde vorm, zelfde gevaar
    // (één gesommeerd totaal over meerdere facturen). Bewust NIET "maandoverzicht" of
    // "jaaroverzicht": dat is vaak juist een verzamelfactuur, en die IS boekbaar.
    /(rekening|saldo|debiteuren|betalings)[-\s]?overzicht/.test(t) ||
    /openstaande\s+(facturen|posten)/.test(t) ||
    /overzicht\s+(van\s+)?openstaande/.test(t) ||
    /overzicht\s+(van\s+)?(je|uw|de)\s+facturen/.test(t);
  if (!overviewTitle) return false;
  const openBalance =
    /totaal\s+openstaand/.test(t) ||
    /nog\s+openstaand/.test(t) ||
    /reeds\s+betaald/.test(t) ||
    /te\s+betalen\s+saldo/.test(t) ||
    /\bvervallen\b/.test(t) ||
    /\bsaldo\b/.test(t);
  const multipleInvoiceRefs =
    (t.match(/factuurnummer|factuurnr\.?|factuur\s+nr|factuurdatum/g) || []).length >= 2;
  return openBalance || multipleInvoiceRefs;
}

// [STATEMENT-HARDEN] The model's REJECTION REASON, in prose, often says exactly what it decided —
// "rekeningoverzicht — samenvatting van bestaande facturen". When it did, we trust that rejection
// and do NOT let the vendor+amount rescue override it. Overview-specific vocabulary only, so a
// generic "geen factuur" reason on a mis-judged verzamelfactuur still gets the benefit of the
// rescue (it enters the verify queue, never lost).
export function looksLikeStatementReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const r = reason.toLowerCase();
  return (
    /(rekening|saldo|debiteuren|betalings)[-\s]?overzicht/.test(r) ||
    /openstaande\s+(facturen|posten)/.test(r) ||
    /samenvatting\s+van\s+\S*\s*factur/.test(r) ||
    /overzicht\s+van\s+(meerdere|bestaande)\s+factur/.test(r) ||
    /meerdere\s+facturen/.test(r)
  );
}

// [TRUST-CONFIDENT-FALSE] The classifier (a small model) can be CONFIDENTLY wrong that a
// document is "not an invoice" — the classic case is a collective invoice (verzamelfactuur:
// many delivery-note lines with their own numbers/dates/amounts) read as a "rekeningoverzicht".
// Silently discarding such a verdict loses a real, bookable invoice with NO trace the owner can
// see. So: when a NOT-an-invoice verdict still carries a STRONG invoice signal — a vendor AND an
// amount — and the filename is not an unmistakable statement, we do NOT trust the rejection. The
// document is routed to the human verify queue flagged 'uncertain' instead of dropped. This is
// money-safe: email/intake invoices enter as 'processing', excluded from BTW/omzet/kosten until
// the human confirms or dismisses — a genuine non-invoice (newsletter, real statement) is simply
// dismissed there, but a real invoice is never again lost unseen. Pure + testable.
export function shouldRescueNonInvoice(
  p: {
    vendor?: string | null;
    total_inc_btw?: number | null;
    total_ex_btw?: number | null;
    amount?: number | null;
    // [STATEMENT] Set by the model when the document is an overview of MULTIPLE invoices. Such a
    // document has a vendor + a (balance) amount, so WITHOUT this guard the rescue below would
    // wrongly resurrect it as one bookable invoice and double-count the invoices it summarises.
    is_statement?: boolean | null;
    // [STATEMENT-HARDEN] The model's own rejection reason. When it explicitly reasoned "this is a
    // rekeningoverzicht / overzicht van meerdere facturen", we trust that over the blunt
    // vendor+amount signal — the fix for the Exact "openstaande facturen" overview that was
    // rejected-with-reason but had is_statement unset and a generic filename, so it got rescued
    // and booked as a phantom cost.
    reason?: string | null;
  },
  filename: string,
): boolean {
  if (p.is_statement === true) return false; // a statement of account is never a bookable invoice
  if (isStatementFilename(filename)) return false; // an unmistakable statement stays rejected
  if (looksLikeStatementReason(p.reason)) return false; // the model itself reasoned it's an overview
  const hasVendor = !!(p.vendor && String(p.vendor).trim());
  const hasAmount =
    p.total_inc_btw != null || p.total_ex_btw != null || p.amount != null;
  return hasVendor && hasAmount;
}

// [CREDIT-BACKSTOP] A document whose printed TOTAL is negative is a credit / correction, even
// when the model did not tag it (e.g. an "expondo Factuurcorrectie — Full return" that never
// writes the word "Creditnota"). Returns true when the row must be treated as a creditnota so
// the negative amount is KEPT instead of being dropped to undefined (which turns a real
// -1.123,14 credit into an empty €0 record). A normal invoice's totals are positive, so this
// never mis-fires on a genuine purchase invoice.
export function shouldTreatAsCreditNote(
  taggedCredit: boolean | undefined,
  rawIncl: unknown,
  rawEx: unknown,
): boolean {
  if (taggedCredit === true) return true;
  const neg = (v: unknown) => typeof v === "number" && isFinite(v) && v < 0;
  const pos = (v: unknown) => typeof v === "number" && isFinite(v) && v > 0;
  // [HUNT-F2] A POSITIVE printed total is never a creditnota. A negative ex under a positive
  // total is an extraction error (e.g. a discount/korting line mis-read into the base), not a
  // credit — leave it for SAFECORE to flag rather than mis-classify it as a creditnota.
  if (pos(rawIncl)) return false;
  return neg(rawIncl) || neg(rawEx);
}

// [EX-INCL-FIX] Some suppliers mislabel the GROSS total as "Subtotaal", so extraction ends up
// with total_ex_btw == total_inc_btw while a real BTW is printed — an impossible combination
// (equal ex and incl implies zero BTW). The incl / paid total and the BTW are the reliable
// anchors (they match what left the bank), so recover the true base: ex = incl − btw. It fires
// ONLY on that exact contradiction (ex ≈ incl with |btw| > 0), so it can never mask a genuine
// mismatch. Sign-safe: on a creditnota (all negative) it yields the correct negative base.
export function fixExInclConfusion(
  ex: number | undefined,
  btw: number | undefined,
  incl: number | undefined,
): number | undefined {
  if (ex === undefined || btw === undefined || incl === undefined) return ex;
  if (Math.abs(btw) > 0.02 && Math.abs(ex - incl) < 0.02) {
    const newEx = incl - btw;
    // [HUNT-F1] Only accept the recomputation when the recovered base implies a PLAUSIBLE NL
    // BTW rate. A reverse-charge / "BTW verlegd" memo captured into btw_amount (ex=1000,
    // btw=210, incl=1000) would otherwise be silently "reconciled" into a fabricated €210
    // deductible BTW + a wrong ex, AND make SAFECORE's sum check pass. Rejecting an out-of-band
    // implied rate leaves ex untouched so SAFECORE holds the invoice for human review.
    const impliedRate = Math.abs(newEx) > 0.005 ? Math.round(Math.abs(btw / newEx) * 100) : 0;
    if (impliedRate >= 0 && impliedRate <= 21) return newEx;
  }
  return ex;
}

// [ASSURANTIE] Insurance premium tax is NOT deductible BTW, and it looks exactly like it.
//
// A real customer document — Univé "Overzicht van uw verzekeringen" for a Detailhandel shop —
// prints a premium of € 236,29 with the line "Inclusief € 41,01 assurantiebelasting". That € 41,01
// is assurantiebelasting (insurance premium tax, 21%), which sits on the same row a BTW figure
// would, in the same euros, at the same rate. It is the one Dutch tax on a business document that
// a VAT-registered owner may NEVER reclaim as voorbelasting — it is part of the cost.
//
// So a reader that captures € 41,01 into btw_amount produces a booking that claims € 41,01 of
// deductible BTW that does not exist. That is not a display slip: it is a euro of refund on the
// aangifte the Belastingdienst will disallow, with a naheffing on top. The direction is the one
// this whole guard family exists to prevent — money out that was never owed in.
//
// The fix is money-safe by construction and asymmetric on purpose:
//   · the deductible BTW becomes 0 and the tax folds back into the cost base (the full paid amount
//     is a non-deductible cost), because under-claiming a small real BTW is recoverable and
//     over-claiming IPT is not;
//   · it NEVER books silently — `corrected` flags the row so classifyImportHealth holds it for a
//     human, exactly like a derived BTW. A rare document that mixes real service-BTW with IPT
//     (an insurance broker's fee) is then corrected upward by the person, at no cost but a review.
//
// It fires only when it actually removes money from the deductible column: assurantiebelasting
// present AND a non-zero btw was read. An insurance receipt the reader already scored at 0 BTW is
// correct as it stands and is left alone — the classification of the document as insurance is a
// separate concern, not this guard's.
export function stripAssurantiebelastingBtw(
  text: string | null | undefined,
  ex: number | undefined,
  btw: number | undefined,
  incl: number | undefined,
): { ex: number | undefined; btw: number | undefined; corrected: boolean } {
  const keep = { ex, btw, corrected: false };
  if (!text) return keep;
  // Normalize away the spacing a layout may insert between the two words ("assurantie belasting")
  // and any casing. The term is unambiguous — it names exactly one Dutch tax — so a substring
  // match carries no false-positive risk beyond documents that genuinely discuss it.
  const norm = text.toLowerCase().replace(/[\s\u00a0]+/g, "");
  if (!norm.includes("assurantiebelasting")) return keep;
  // Nothing in the deductible column to remove → leave the document untouched. Whether it is
  // classified as insurance is decided elsewhere; this guard only protects the BTW.
  if (btw === undefined || Math.abs(btw) < 0.005) return keep;
  // Fold the premium tax back into the cost base: the whole paid amount is the (non-deductible)
  // cost. Prefer the printed incl total; fall back to ex+btw when incl was not read.
  const newEx =
    incl !== undefined && isFinite(incl)
      ? incl
      : ex !== undefined && isFinite(ex)
        ? round2(ex + btw)
        : ex;
  return { ex: newEx, btw: 0, corrected: true };
}

// [BTW-SUM-FIX] On a MIXED-RATE invoice the BTW total is the one figure that is NOT printed as a
// single number. The summary block prints one ROW PER RATE — each with its own grondslag on the
// left and its own BTW on the right:
//     € 2.591,71   BTW 9% excl.    €  233,20
// so the reader must pick the right column and add it up itself. That is where it slips. The Enka
// Horeca case read btw = 995,90 over a printed excl of 3.413,92 and a printed total of 3.819,82:
// a 29% rate (impossible in NL) and excl + BTW ≠ totaal, so SAFECORE held it with a reason the
// owner could do nothing with. The two numbers it did NOT have to compute are both printed verbatim
// ("Totaal exclusief BTW" and "Totaal te voldoen"), and their difference is exactly the true BTW:
// 3.819,82 − 3.413,92 = 405,90, a legal 12% blend of 9% and 21%.
//
// So when the STATED BTW is PROVABLY impossible (implied rate outside 0–21%, which no NL rate or
// blend of them can reach) while the difference between the two printed anchors IS a legal rate,
// the mis-summed figure is the one to replace. Deliberately narrow: it never fires when the stated
// BTW is merely inconsistent but plausible, because then we cannot tell WHICH of the three numbers
// is wrong and SAFECORE must keep holding it for the human.
//
// `derived` is reported back so the caller can mark the invoice: the repaired BTW makes the sum
// add up, but it is OUR arithmetic rather than the invoice's, and BTW is deductible money in the
// aangifte. A derived BTW therefore stays in the verify queue and never auto-books.
export function fixMisSummedBtw(
  ex: number | undefined,
  btw: number | undefined,
  incl: number | undefined,
): { btw: number | undefined; derived: boolean } {
  const keep = { btw, derived: false };
  if (ex === undefined || btw === undefined || incl === undefined) return keep;
  if (!isFinite(ex) || !isFinite(btw) || !isFinite(incl)) return keep;
  // Without a base there is no rate to reason about — and no way to tell right from wrong.
  if (Math.abs(ex) < 0.005) return keep;
  // Only a genuine contradiction is repairable; a consistent invoice is never touched.
  if (Math.abs(ex + btw - incl) <= 0.02) return keep;

  const rateOver = (v: number) => Math.round(Math.abs(v / ex) * 100);
  // The stated BTW must be provably wrong — not merely surprising.
  if (rateOver(btw) <= 21) return keep;

  const derivedBtw = round2(incl - ex);
  // ...and the replacement must be provably plausible: a legal blended rate, charged in the same
  // direction as the base it sits on (a sign flip means a different document, not a bad sum).
  if (rateOver(derivedBtw) > 21) return keep;
  if (derivedBtw !== 0 && Math.sign(derivedBtw) !== Math.sign(ex)) return keep;

  return { btw: derivedBtw, derived: true };
}

// [VISUAL-REREAD] Decide whether a cheap TEXT read is weak enough to justify one re-read of the
// same PDF on the same Haiku model but via the raw VISUAL layout (which preserves the table
// columns the flattened text loses). Only fires on something the model already called an invoice
// AND for which it found a total (a truly-empty read is handled by the existing raw-PDF fallback,
// not here) — so the re-read is spent recovering the fields most often lost on complex layouts:
// the invoice number, the ex/BTW split, an amount the reader itself scored low, or the SUPPLIER.
// No model-cost increase (same Haiku), just a second pass that sees the page. Pure + testable.
//
// ── [LEVERANCIER-STAAT-IN-HET-LOGO] Why the vendor belongs on this list ──────────────────────
//
// Invoice 26004628. Its whole text layer is 199 characters, and the company that sent it is in
// none of them: the PDF (Creator: Exact Online) carries four embedded IMAGES and the letterhead is
// one of them. What the text DOES contain is "T.H.T. datum Jim Ketels 01-09-2026 09:38" — a
// deliverer's stamp — so the reader answered the vendor question with the only name on offer, and
// scored itself LOW while doing it. The real sender is W. Ketels en Zoon Eierhandel, and it is on
// the page: as pixels.
//
// Every guard downstream held. The receiver rule correctly excluded the owner's own name; the
// registry did not overwrite what was read; vendor-grounding could not object, because "Jim
// Ketels" IS printed in that text. Nothing was wrong except the one thing nobody asked: whether
// the text we handed the model could answer the question we asked of it.
//
// extractPdfTextIfTextLayer answers that with MIN_CHARS/MIN_DIGITS — 168 chars and 73 digits, so
// it passes. But those thresholds measure the VOLUME of text, and volume is a proxy: it separates
// a scan with stray characters from a real text layer, which is what it was written for, and says
// nothing about whether the letterhead came along. Raising them would trade this miss for a
// different arbitrary line.
//
// So the vendor is answered where the other weak fields already are: by the model's own score.
// field_confidence.vendor is documented in the prompt as "how certain you are the vendor (sender)
// is correct", it is the same signal the screen already shows the owner as "De AI was niet zeker
// over de leverancier", and it was LOW on this invoice. The app's answer to that was to ask the
// human — without first trying the one thing that can actually answer it, which is looking at the
// page. The raw path SEES the logo.
//
// The threshold is 0.7, the same number the queue's own banner uses (vendorLow in
// IncomingInvoicesClient). One threshold: a re-read that fires on a different line than the
// warning would either warn about invoices it silently fixed, or fix invoices it never warned
// about.
export function needsVisualReread(
  p:
    | {
        is_invoice?: boolean;
        invoice_number?: string | null;
        total_inc_btw?: number | null;
        total_ex_btw?: number | null;
        btw_amount?: number | null;
        amount?: number | null;
        field_confidence?: { amount?: number; vendor?: number } | null;
        vendor?: string | null;
      }
    | null
    | undefined,
): boolean {
  if (!p || p.is_invoice !== true) return false;
  const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);
  const total = isNum(p.total_inc_btw) ? p.total_inc_btw : isNum(p.amount) ? p.amount : undefined;
  if (total === undefined) return false;
  const missingNumber = !p.invoice_number || !String(p.invoice_number).trim();
  const missingBreakdown = !(isNum(p.total_ex_btw) && isNum(p.btw_amount));
  const amountScore = p.field_confidence?.amount;
  const lowAmountConfidence = isNum(amountScore) && amountScore < LOW_CONFIDENCE;
  // [LEVERANCIER-STAAT-IN-HET-LOGO] A vendor the reader is unsure of, or none at all. Both are the
  // same question — "who sent this?" — asked of a page whose answer may only exist as pixels.
  const vendorScore = p.field_confidence?.vendor;
  const weakVendor =
    (isNum(vendorScore) && vendorScore < LOW_CONFIDENCE) ||
    !String(p.vendor ?? "").trim();
  return missingNumber || missingBreakdown || lowAmountConfidence || weakVendor;
}



// Base system prompt — shared by all functions
const SYSTEM_BASE = `You are an AI assistant for BoekBrug, a financial workflow platform in the Netherlands.

Rules you never break:
- Output language for invoices and emails: always Dutch (nl-NL)
- Number format: Dutch — 1.234,56
- Date format: Dutch — 15-05-2026
- Tone: professional but simple and clear
- Many users are not native Dutch speakers — keep language simple
- Return only JSON, no markdown, no explanation`;

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────
export interface ClassifyDocumentResult {
  type: 'invoice' | 'receipt' | 'quote' | 'reminder' | 'ad' | 'unknown';
  confidence: number;
  vendor?: string;
  amount?: number;
  date?: string;
  isDuplicate?: boolean;
}

// [TRUST-UNCERTAIN] Decide what to do with a read given its overall confidence and
// whether it carries any invoice signal (a vendor or an amount). The old code hard-
// dropped everything below 0.6 as "not an invoice" — silently losing real but hard-
// to-read invoices. This never drops a signal-bearing read in the uncertain band;
// it routes it to human review instead. Pure + exported so it is unit-tested.
//   >= 0.60                         → 'accept'  (normal flow)
//   [0.35, 0.60) with signal        → 'review'  (flow to verify queue, FLAGGED)
//   < 0.35, or no invoice signal    → 'skip'    (spam / newsletter / unreadable)
export type ConfidenceBand = 'accept' | 'review' | 'skip';
export function decideConfidenceBand(confidence: number, hasInvoiceSignal: boolean): ConfidenceBand {
  if (!(confidence >= 0)) return 'skip'; // NaN/negative → skip
  if (confidence >= 0.6) return 'accept';
  if (confidence >= 0.35 && hasInvoiceSignal) return 'review';
  return 'skip';
}

// [BOEK-011] Result of reading an actual PDF — May 2026
export interface VerifyInvoiceResult {
  is_invoice: boolean;       // true only if this is a real commercial invoice
  confidence: number;        // 0–1
  // [TRUST-UNCERTAIN] The reader saw likely-invoice content but was NOT confident
  // it read it correctly (blurry photo, odd/foreign layout). Such an item is routed
  // to the human verify queue FLAGGED — never silently dropped. Distinct from
  // is_invoice:false (confidently NOT an invoice → quietly skipped).
  uncertain?: boolean;
  // [FAIR-USE §3] True when the verdict was reached WITHOUT any model call (e.g. an invalid
  // PDF caught by the pre-flight check). The caller releases the fair-use reservation.
  no_ai_call?: boolean;
  vendor?: string;           // who sent the invoice
  amount?: number;           // total amount including BTW (numeric) — alias of total_inc_btw
  invoice_number?: string;   // invoice number if found
  invoice_date?: string;     // DD-MM-YYYY
  // [EXTRACT-DUE-DATE] Two SEPARATE raw signals — the AI never computes the due
  // date itself (arithmetic stays in our code via safecore.deriveDueDate). It
  // only reports what the invoice literally states:
  //   due_date          → an EXPLICIT "Vervaldatum: 27-05-2026" if printed
  //   payment_term_days → a payment TERM ("Betaling binnen 14 dagen") as a number
  // Both null when absent; deriveDueDate() then applies the priority + math.
  due_date?: string;         // explicit due date if stated, "YYYY-MM-DD"
  payment_term_days?: number; // "binnen X dagen" term, in days
  // [PAY-SAFE-EXTRACT] Vendor payment details — the IBAN to PAY and the
  // payment reference (betalingskenmerk). Used later to PREPARE a payment
  // (EPC/SEPA QR or pre-filled details) the owner executes in their OWN bank.
  // BoekBrug never processes money — these only prepare it. Null when absent.
  vendor_iban?: string;      // the vendor's IBAN (party to be paid), normalized
  payment_reference?: string; // betalingskenmerk / structured payment reference
  // [SUPPLIER-IDENTITY] The vendor's LEGAL identity — the strongest keys for recognising the same
  // supplier across differently-spelled names (two "Jansen" firms have different KVK). Extracted
  // here so the supplier registry can match/store them. Null when the invoice doesn't print them.
  vendor_kvk?: string;       // vendor KVK number, digits only (8 digits, Dutch Chamber of Commerce)
  vendor_btw?: string;       // vendor BTW/VAT number, e.g. NL123456789B01 (no spaces, uppercase)
  // [SMART-INTAKE] What KIND of document this is, so the intake router can send
  // it to the right destination. A "receipt"/kassabon is a PAID proof; an
  // "invoice" is a payment request (usually unpaid). "other" → not a financial
  // document for the invoice pipeline (route to bestanden instead).
  document_kind?: "invoice" | "receipt" | "other";
  // [AANSLAG] When the sender is the Belastingdienst: which tax the letter concerns. A tax letter
  // is a payable, not a cost — see tax-letter.ts for where each kind books. Null on an ordinary
  // invoice. Normalised to the closed list; anything else becomes null.
  tax_kind?: TaxKind | null;
  // [SMART-INTAKE] Did this document indicate it is ALREADY PAID? True for a
  // kassabon / pin-receipt (paid at the counter). The router uses this to
  // pre-suggest "paid" in the verify queue — the human still confirms (Pillar ⑤).
  is_paid?: boolean;
  // [PEN-MARK] When the owner has WRITTEN on the paper (pen) or a shop STAMPED it — "betaald",
  // "voldaan", "contant/kas", "bank", "pin", often with a date — read that annotation. These let
  // the verify queue pre-suggest paid + how + when, so a snapped-and-thrown invoice needs one
  // confirming tap instead of manual data entry. Null when there is no such mark. NEVER
  // auto-books payment — it only pre-fills a suggestion the human confirms.
  paid_method?: "bank" | "kas" | "pin" | null; // 'kas' = contant/cash
  paid_date?: string | null;                    // the written/stamped payment date, "YYYY-MM-DD"
  // [BON-BETAALWIJZE] The tender block a kassabon PRINTS, copied verbatim ("Bankpas 70,29",
  // "KONTANT 120,00 Afronding 0,02 Wisselgeld 7,10"). Kept as literal text on purpose: the
  // classification into bank/kas happens in bon-betaalwijze.ts, which is pure and unit-tested
  // against real receipts, so the decision does not drift with the model. Null when absent.
  paid_evidence?: string | null;
  // Last 4 digits of the card when the receipt masks and prints it. Makes the later bank match
  // reliable (the same four digits appear on the statement line). Never invented.
  paid_card_last4?: string | null;
  // [BRIDGE-CREDITNOTA-SIGN] Is this a CREDITNOTA (credit note)? True only on
  // explicit evidence: a "Creditnota"/"Credit note" title, a CR-prefixed
  // number, or amounts printed negative. Routing is unaffected (a creditnota
  // still goes to the verify queue like any invoice — document_kind stays
  // 'invoice'); this flag drives invoice_type='creditnota' at storage and the
  // sign-inverted SAFECORE gate. Amounts on a creditnota are kept NEGATIVE as
  // printed — matching the outgoing creditnota route [BOEK-031].
  is_credit_note?: boolean;
  // [ASSURANTIE] Did the document print "assurantiebelasting" (insurance premium tax)? That tax
  // looks exactly like BTW — same euros, same 21% — but is the one Dutch tax a VAT-registered
  // owner may NEVER reclaim as voorbelasting. The reader reports the fact; stripAssurantiebelastingBtw
  // enforces the consequence (btw → 0, folded into the cost) and flags it for a human. True only
  // on the literal word.
  has_assurantiebelasting?: boolean;
  /**
   * [VERLEGD-NAAR-MIJ] De leverancier heeft de BTW naar deze eigenaar VERLEGD (art. 12 lid 5 Wet
   * OB). Zo'n factuur draagt geen BTW, en het bedrag hoort in rubriek 2a én in 5b van de aangifte.
   * Een vlag en géén bedrag, met opzet: het TARIEF staat niet op zo'n document, dus het model kan
   * het niet lezen en mag het niet verzinnen. Zie verlegde-btw.ts.
   */
  has_btw_verlegd?: boolean;
  // [STATEMENT] Is this a STATEMENT OF ACCOUNT — a "rekeningoverzicht" / "openstaande facturen"
  // that LISTS MULTIPLE separate invoices with a summed balance? It is NOT a bookable invoice:
  // booking its total double-counts the individual invoices (which arrive on their own). True
  // ONLY for a genuine overview of TWO OR MORE invoices; a single collective invoice
  // (verzamelfactuur) is NOT a statement. When true we force is_invoice=false and never rescue it.
  is_statement?: boolean;
  // [REMINDER] Is this a payment REMINDER (betalingsherinnering / aanmaning) for an invoice
  // that was already sent earlier — not a fresh invoice? A reminder restates an existing debt
  // (often with added herinneringskosten), so booking it as a NEW invoice double-counts the
  // cost. True on explicit evidence: a "herinnering"/"aanmaning"/"betalingsherinnering"/
  // "reminder" title or a "2e/laatste herinnering" heading over a single restated invoice.
  // We never discard it (it might be the first time we see that invoice), but we FLAG it so it
  // lands in the verify queue marked "controleer of de factuur al geboekt is" — never booked
  // silently as a second cost.
  is_reminder?: boolean;
  // [REMINDER] The ORIGINAL invoice number this is a reminder OF (when known), so the verify
  // queue and dedup can point the owner at the invoice that may already be booked.
  reminder_of_invoice_number?: string | null;
  reason?: string;           // why it was rejected (if is_invoice = false)
  // [BOEK-011] detailed BTW breakdown — extracted in the same call, zero extra cost
  total_ex_btw?: number;     // amount excluding BTW
  btw_amount?: number;       // the BTW amount itself
  total_inc_btw?: number;    // total including BTW
  btw_rate?: number;         // detected rate: 0, 9 or 21
  // [PRINTED-TOTAL] The final total EXACTLY as printed, copied without any arithmetic. Kept apart
  // from total_inc_btw for one reason: so the two can DISAGREE. The moment the reader is allowed
  // to reconcile them, the disagreement — which is the only evidence a misread happened — is gone.
  total_printed?: number | null;
  // [BTW-SPLIT] The per-rate summary block as printed: one entry per rate row, `base` the LEFT
  // (grondslag) column and `btw` the RIGHT one. On a mixed-rate invoice this is the only thing
  // that can verify the btw total, because the legal-rate constraint no longer applies to a blend.
  btw_breakdown?: { rate: number; base: number; btw: number }[] | null;
  // [VREEMDE-VALUTA] The currency code printed beside the amounts, as printed. Read, never
  // assumed: null means the document said nothing, which is the normal case and changes nothing.
  // See vreemde-valuta.ts for why a positive reading holds the invoice and nothing converts.
  currency?: string | null;
  // [REGELS] The invoice's own lines, as printed. Read for one reason above all: on a MIXED-rate
  // document without a summary block the lines are the ONLY thing left that can corroborate the
  // btw — group them per rate, apply the rate, and the result has to reproduce the printed total.
  // See factuurregels.ts. `amount` is the line total EXCLUDING btw.
  invoice_lines?: { description?: string | null; quantity?: number | null; unit_price?: number | null; btw_rate?: number | null; amount?: number | null }[] | null;
  // [BRIDGE-EXTRACT] Per-field confidence (0–1) — lets the UI ask the user to
  // confirm ONLY the fields the AI is unsure about, instead of guessing silently.
  field_confidence?: {
    vendor?: number;
    invoice_number?: number;
    invoice_date?: number;
    // [TRUST-AMOUNTS] The reader's own certainty about the AMOUNTS it read — the
    // money-truth. Only set when the model actually reports it; absent means "no
    // signal", NOT "certain" (import-health only flags a low score that is present).
    amount?: number;
    // [BTW-SUM-FIX] Set ONLY when the printed BTW total could not be read from a mixed-rate
    // summary block and had to be derived from the two printed anchors (excl + the paid total).
    // Carries both figures so the owner sees exactly what changed; its presence keeps the
    // invoice in the verify queue (a derived BTW is never auto-booked).
    _btw_derived?: { read: number | null; used: number | null };
    // [EIGEN-CONTROLE-ONBEKEND] Set when the own-sales-invoice lookup could not run. Not a verdict
    // — the document may well be a real supplier bill — but the one check that would have caught
    // the owner's OWN invoice coming back as a cost did not answer, so a human looks. Never a
    // refusal: a database hiccup must not reject a genuine purchase invoice.
    _own_check_unavailable?: boolean;
    // [ASSURANTIE] Set when assurantiebelasting was stripped from the deductible BTW. Keeps the
    // document in the verify queue (never auto-booked) and drives the owner-facing reason.
    _assurantiebelasting?: { read: number | null };
    // [VERLEGD-NAAR-MIJ] Gezet wanneer de leverancier de BTW naar deze eigenaar heeft verlegd.
    // Alleen vastgelegd — de factuur zelf is goed zoals ze is; de aangifte doet er iets mee
    // (rubriek 2a, en dezelfde euro's terug in 5b). Zie verlegde-btw.ts.
    _btw_verlegd?: { grondslag: number | null };
    // [EX-INCL-FIX] Set when the base was recovered from incl − btw (a mislabelled "Subtotaal").
    _ex_corrected?: { read: number | null; used: number | null };
    // [NUL-BTW-STIL] Set by an ingestion door that BOOKED a zero BTW the document does not explain
    // — no 0 %-tarief, no verlegging, a material total. Never written by the reader itself: it is a
    // statement about what was stored, not about what was read. Its presence keeps the row visible
    // for a human, because the identity holds by construction and nothing else would mention it.
    _btw_zero_unexplained?: boolean;
    // [BTW-SPLIT] The per-rate block, carried through to storage so the checklist can verify a
    // mixed-rate btw instead of reporting it as checked when nothing checked it.
    _btw_rows?: { rate: number; base: number; btw: number }[];
    // [ZELFFACTUUR] Set when the document says, in its own characters, that the CUSTOMER drew it
    // up (zelffacturering, art. 35 Wet OB). Which side the owner is on decides whether this is
    // their own turnover or a real purchase, and nothing on the paper answers that — so it is
    // recorded and a human looks. See zelffacturering.ts.
    _zelffactuur?: boolean;
    // [VREEMDE-VALUTA] Set when the document named a currency that is not the euro. The amounts
    // stored are the amounts PRINTED — unconverted, because nothing here has a rate — so this key
    // is what stops them being treated as euros, and what names the currency on screen.
    _valuta?: { code: string };
    // [REGELS] A per-rate split we built from the invoice's OWN LINES, and only when it reproduced
    // both printed anchors. Different evidence from _btw_rows — that one the supplier printed,
    // this one the goods imply — so it is kept apart and never merged into it.
    _btw_rows_uit_regels?: { rate: number; base: number; btw: number }[];
    // [PRINTED-TOTAL] The printed final total, and — when it differs from what we stored — the
    // fact that WE produced one of the three amounts rather than reading it.
    _total_printed?: number | null;
    _total_derived?: 'total' | 'excl';
  };
}

export interface TranslateResult {
  translation: string;
  original: string;
}

export interface ComposeDraftEmailResult {
  subject: string;
  body: string;
}

export interface MatchTransactionResult {
  matched: boolean;
  invoice_id?: string;
  confidence: number;
  reason: string;
}

export interface ClassifyExpenseResult {
  category: 'fuel' | 'equipment' | 'subscription' | 'travel' | 'office' | 'other';
  btw_eligible: boolean;
  confidence: number;
}

// [BOEK-015] Company details extracted from an invoice during onboarding
export interface ExtractCompanyDetailsResult {
  company_name: string | null;
  kvk_number: string | null;   // 8 digits, Dutch KVK
  btw_number: string | null;   // NL + 9 digits + B + 2 digits
  iban: string | null;
  address: string | null;
  found: boolean;              // true if at least company_name or kvk was found
}

// [BOEK-018] GenerateInvoiceFromPromptResult type — May 2026
export interface GenerateInvoiceLineResult {
  description: string;
  quantity: number;
  unit_price: number;
  btw_rate: 0 | 9 | 21;
}

// [BOEK-018] fix: add description, amount, btw_rate top-level fields — May 2026
export interface GenerateInvoiceFromPromptResult {
  client_name: string;
  client_email?: string | null;
  description?: string;        // top-level summary of the work (optional)
  amount?: number;             // total amount incl. BTW if mentioned in prompt
  btw_rate?: 0 | 9 | 21;      // top-level btw_rate if a single rate applies to all lines
  lines: GenerateInvoiceLineResult[];
  notes?: string | null;
}

interface TransactionInput {
  amount: number;
  date: string;
  description: string;
  counterpart: string;
}

interface InvoiceInput {
  id: string;
  invoice_number: string;
  total_inc_btw: number;
  client_name: string;
  invoice_date: string;
}

// ─────────────────────────────────────────────────────────
// Base caller — text only
// [BOEK-018] core fetch wrapper — May 2026
// ─────────────────────────────────────────────────────────

// [LEZER-KLOK] The reader call had no clock of its own, and the platform's is not a substitute.
//
// fetch() here carried no signal, and undici's own ceilings (300 s) sit far above every route that
// calls this. So a connection that stalls rather than fails does not throw — it hangs until Vercel
// kills the whole function, and a killed function runs NO catch block. That is the one hole
// [BEWAAR-EERST] cannot cover from the outside: the upload door stores the file when the read
// THROWS, and a lambda that is killed never gets there. The owner then waits two minutes and gets
// a platform error page, with nothing kept and their monthly reading spent.
//
// The budget is a DEADLINE for the whole call, not a per-attempt timeout. A per-attempt timeout
// short enough to leave room for a retry would clip the slow tail of a legitimate vision read
// (a dense multi-page PDF), which is a self-inflicted failure on a document that was going to
// succeed. With a deadline, a healthy slow read gets the entire budget and a stalled one leaves
// no time for a second attempt — which is correct, because there is nothing left to spend it on.
//
// 60 s sits above every real read measured here (10-30 s) and leaves the tightest caller
// (/api/intake, maxDuration 120) a full minute to store the file and answer honestly.
const READER_BUDGET_MS = 60_000

/** An abort raised by our own deadline, phrased so isTransientAiError recognises it. */
function isAbortError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name
  return typeof name === 'string' && /^(AbortError|TimeoutError)$/i.test(name)
}

// [BOEK-011 double-check m.3] Retry transient Claude failures once.
// A single 429 (rate limit) or 5xx during a big backfill would otherwise cost a
// whole sync round per invoice (the invoice isn't lost — email-integration
// retries next sync — but it's wasteful). One short backoff retry absorbs the
// common transient blips. We do NOT retry 4xx other than 429 (a 400 bad-PDF or
// 401 bad-key won't fix itself), and we cap at 2 attempts total to stay well
// inside the function time budget.
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string
): Promise<Response> {
  const isRetryable = (status: number) => status === 429 || status >= 500;

  const deadline = Date.now() + READER_BUDGET_MS
  let lastErr: unknown = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    const left = deadline - Date.now()
    if (left <= 0) break
    try {
      // [LEZER-KLOK] Whatever is left of the budget, never more.
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(left) })
      if (res.ok) return res
      if (attempt < 2 && isRetryable(res.status)) {
        // Respect Retry-After when present (seconds), else a short fixed backoff.
        const retryAfter = Number(res.headers.get('retry-after'))
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 5000)
          : 1200
        // Waiting past the deadline to make an attempt we cannot finish spends the caller's
        // remaining time on nothing. Hand back the response we have and let it be read as the
        // error it is.
        if (deadline - Date.now() <= waitMs) return res
        console.warn(`[BOEK-011] ${label} ${res.status} — retrying in ${waitMs}ms`)
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      return res // non-retryable, or out of attempts → let caller read the error
    } catch (err) {
      // Network-level throw (DNS, socket) — retry once, then rethrow. An abort is OUR deadline,
      // and it is relabelled here: the DOMException says only "This operation was aborted", which
      // no classifier can tell apart from a caller cancelling on purpose.
      lastErr = isAbortError(err)
        ? new Error(`${label}: request timeout after ${READER_BUDGET_MS} ms`)
        : err
      if (attempt < 2 && deadline - Date.now() > 1200) {
        console.warn(`[BOEK-011] ${label} network error — retrying`, err)
        await new Promise((r) => setTimeout(r, 1200))
        continue
      }
    }
  }
  throw lastErr ?? new Error(`${label}: request failed`)
}

// [BOEK-COST] Prompt caching. The system prompt (the long extraction rules,
// ~1.5k tokens) is identical on every invoice call, so we mark it cacheable:
// the first call in a 5-minute window pays a small write premium (1.25×), every
// subsequent call reads it at 0.1× — a 90% discount on that portion. During a
// backfill (dozens of calls per minute) almost all calls are cache hits.
// After image downscaling the system prompt is the LARGEST remaining input, so
// this is where the second-biggest saving now lives. Structured as a
// single-element array so a plain string can't accidentally lose the marker;
// prompt caching is GA (no beta header needed).
function cacheableSystem(systemPrompt: string): Array<{
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}> {
  return [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
}

async function callClaude(
  prompt: string,
  systemPrompt: string,
  model: string = CLAUDE_MODEL
): Promise<string> {
  // [COST-GUARD] Reserve before spending. A refusal throws, which every caller
  // already handles as "AI unavailable" and degrades to manual entry.
  const budget = await reserveAiBudget({
    inputTokens: TOKEN_ESTIMATE.shortText + Math.ceil((prompt.length + systemPrompt.length) / 4),
    maxOutputTokens: MAX_TOKENS,
    label: 'callClaude',
  })
  if (!budget.allowed) throw new Error(AI_BUDGET_EXHAUSTED_ERROR)

  const response = await fetchWithRetry(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',  // [BOEK-018] fix: API key was missing
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system: cacheableSystem(systemPrompt),
      messages: [{ role: 'user', content: prompt }],
    }),
  }, 'Claude API')

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error ${response.status}: ${error}`);
  }

  const data = await response.json();
  // [COST-GUARD] Correct the reservation to what this actually cost — BEFORE the
  // shape check below, because an answer we cannot parse was still paid for.
  await settleAiBudget({ reserved: budget, usage: data?.usage, label: 'callClaude' })
  const content = data.content?.[0];
  if (!content || content.type !== 'text') {
    throw new Error('Claude API returned unexpected response shape');
  }
  return content.text;
}

// ─────────────────────────────────────────────────────────
// [BOEK-011] cleanBase64 — normalize base64 before sending to Claude
// Handles: data URL prefix, base64url chars, whitespace, padding — May 2026
// ─────────────────────────────────────────────────────────
function cleanBase64(raw: string): string {
  // Remove data URL prefix if present (e.g. "data:application/pdf;base64,...")
  const withoutPrefix = raw.includes(",") ? raw.split(",")[1] : raw;

  // Convert base64url → standard base64, strip whitespace
  const normalized = withoutPrefix
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/\s/g, "");

  // [BOEK-011] Fix padding — base64 length must be a multiple of 4.
  // Gmail's base64url often drops trailing '=' padding. Claude rejects it.
  const remainder = normalized.length % 4;
  if (remainder === 0) return normalized;
  return normalized + "=".repeat(4 - remainder);
}

// ─────────────────────────────────────────────────────────
// [PDF-OPTIMIZE] Text-layer extraction — the cost lever for text PDFs
// ─────────────────────────────────────────────────────────
//
// WHY: a text PDF (exported from an accounting program — the majority of our
// supplier invoices: BALKIP, FAMZFOOD, Dutch Sweets, Ketels) sent RAW through
// Claude's document API costs ~2425 input tokens, because Claude both reads the
// text layer AND renders the page as an image internally. If we extract the
// text ourselves and send TEXT ONLY, the same invoice costs ~840 tokens — a
// measured ~65% saving, with SAFECORE verified: on real Kiwi data Claude
// returned byte-identical amounts on both paths, and the "Nieuwe schuld"
// running-balance trap did NOT hijack the total.
//
// SCOPE (deliberately narrow — we do NOT touch what works):
//   · This ONLY affects TEXT PDFs. A scanned PDF (image inside a PDF) yields
//     little/no extractable text → we return null → caller keeps the EXISTING
//     raw-PDF path unchanged. Scanned invoices behave EXACTLY as before.
//   · CONSERVATIVE gate: we take the text path ONLY on strong evidence the PDF
//     is genuinely text (plenty of characters AND digits). Any doubt → null →
//     raw path. The asymmetry is intentional: a wrong "text" verdict could send
//     a partial extraction to Claude (bad); a wrong "scanned" verdict just sends
//     the raw PDF (safe, only costlier). We always err toward the safe/raw side.
//
// SAFETY:
//   · FAIL-SAFE: any error (pdfjs missing, decode failure, client context)
//     returns null → caller uses the raw PDF. Cost optimisation must never drop
//     or corrupt an invoice.
//   · typeof window guard — pdfjs is server-only; on the client we skip.
//   · Downstream SAFECORE (ex+btw=total) still validates, a second net.
//
// Returns the extracted text when the PDF is confidently text-based, else null.
async function extractPdfTextIfTextLayer(pdfBase64: string): Promise<string | null> {
  // Conservative thresholds — a real text invoice has abundant text + numbers.
  // Below these we do NOT trust extraction and fall back to the raw PDF.
  const MIN_CHARS = 100;
  const MIN_DIGITS = 20;

  try {
    // pdfjs is a server-only ESM module. On the client, skip (fail-safe → raw).
    if (typeof window !== 'undefined') return null;

    const clean = cleanBase64(pdfBase64);
    const bytes = Buffer.from(clean, 'base64');

    // [PDF-OPTIMIZE] Use `unpdf` for text extraction. It bundles a serverless
    // build of pdf.js that MOCKS the canvas dependency, so it works on Vercel
    // without @napi-rs/canvas — unlike importing pdfjs-dist/legacy directly,
    // which tries to load @napi-rs/canvas at import time and FAILS on serverless
    // (observed in prod: "Cannot find module '@napi-rs/canvas'" → import returns
    // null → we silently fell back to raw for EVERY PDF, i.e. zero saving).
    // Verified: unpdf extracts byte-identical text to pdfjs v6 on real Kiwi data
    // (same char/digit counts, all critical amounts + the "Nieuwe schuld" trap
    // separation preserved), so SAFECORE parity holds.
    const unpdf = await import('unpdf').catch(() => null);
    if (!unpdf) {
      console.warn('[PDF-OPTIMIZE] unpdf unavailable — using raw PDF path');
      return null;
    }

    const doc = await unpdf.getDocumentProxy(new Uint8Array(bytes));
    const { text: extracted } = await unpdf.extractText(doc, { mergePages: true });
    const text = (extracted ?? '').trim();

    // Confidence gate — strong evidence this is a genuine text PDF, not a scan
    // with a few stray characters. Both conditions must hold.
    const chars = text.replace(/\s/g, '').length;
    const digits = (text.match(/\d/g) || []).length;
    if (chars < MIN_CHARS || digits < MIN_DIGITS) {
      console.log('[PDF-OPTIMIZE] Weak text layer — raw PDF path', { chars, digits });
      return null;
    }

    console.log('[PDF-OPTIMIZE] Text PDF → text path', { chars, digits });
    return text;
  } catch (err) {
    // FAIL-SAFE: never let extraction trouble drop or corrupt an invoice.
    console.warn('[PDF-OPTIMIZE] Text extraction failed — using raw PDF', err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────
// PDF caller — sends actual PDF bytes to Claude
// [BOEK-011] reads the real content, not just metadata — May 2026
// ─────────────────────────────────────────────────────────
/**
 * [GEGROND-OCR] Read the amounts off a document that has no text layer, so the grounding check can
 * run on a PHOTO too.
 *
 * The call is deliberately blind: it receives the file and a fixed instruction, and NOTHING from the
 * extraction that just ran. Show a model a number and ask it to check that number and it will agree;
 * the exercise then measures nothing while reporting confidence. That independence is the entire
 * value here, and a source gate holds it.
 *
 * Best-effort by construction: any failure — budget, network, an empty reply — returns null, which
 * the grounding check reads as 'unreadable'. A transcription that did not happen is not evidence
 * about the document, and must never harden into "the amount is absent".
 */
/**
 * [GEGROND-OCR] Public entry for the same blind transcription, so the books-audit can run it over a
 * PHOTO that is already stored.
 *
 * Exported rather than duplicated: a second copy of this would be a second prompt, and the moment
 * the two drift the audit stops measuring what the import measures. The independence rule travels
 * with it — the caller passes a FILE, never anything derived from a read of that file.
 */
export async function transcribeStoredDocumentAmounts(
  fileBase64: string,
  mediaType: string,
  model?: string,
): Promise<string | null> {
  return transcribeAmountsForGrounding(fileBase64, mediaType, model ?? CLAUDE_MODEL);
}

async function transcribeAmountsForGrounding(
  fileBase64: string,
  mediaType: string,
  model: string,
): Promise<string | null> {
  try {
    const isImage = /^image\/(jpeg|png|webp|gif)$/.test(mediaType);
    const reply = isImage
      ? await callClaudeWithImage(
          fileBase64,
          mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
          OCR_AMOUNTS_PROMPT, OCR_AMOUNTS_SYSTEM, model,
        )
      : await callClaudeWithPdf(fileBase64, OCR_AMOUNTS_PROMPT, OCR_AMOUNTS_SYSTEM, model);
    const haystack = parseOcrAmounts(reply);
    // A reply with one token is far more likely to be a model that gave up than an invoice with one
    // number on it. Treating that as a real search space would turn every amount into a false
    // 'absent' — a warning that is wrong is worse than no warning.
    if (ocrAmountCount(haystack) < MIN_OCR_AMOUNTS) return null;
    return haystack;
  } catch (e) {
    console.warn('[GEGROND-OCR] transcription unavailable — grounding stays unreadable', {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

async function callClaudeWithPdf(
  pdfBase64: string,
  prompt: string,
  systemPrompt: string,
  model: string = CLAUDE_MODEL
): Promise<string> {
  // [BOEK-011] Fix: clean base64 before sending — removes prefix and normalizes encoding
  const cleanData = cleanBase64(pdfBase64)

  // [COST-GUARD] A raw PDF is the most expensive shape we send.
  const budget = await reserveAiBudget({
    inputTokens: TOKEN_ESTIMATE.rawPdfDocument,
    maxOutputTokens: MAX_TOKENS,
    label: 'callClaudeWithPdf',
  })
  if (!budget.allowed) throw new Error(AI_BUDGET_EXHAUSTED_ERROR)

  const response = await fetchWithRetry(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',  // [BOEK-018] fix: API key was missing
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25', // required for PDF support
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system: cacheableSystem(systemPrompt),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: cleanData,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    }),
  }, 'Claude PDF API');

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude PDF API error ${response.status}: ${error}`);
  }

  const data = await response.json();
  // [COST-GUARD] A raw PDF is the shape the reservation over-estimates most: the
  // system prompt is a cache read on all but the first of a batch.
  await settleAiBudget({ reserved: budget, usage: data?.usage, label: 'callClaudeWithPdf' })
  const content = data.content?.[0];
  if (!content || content.type !== 'text') {
    throw new Error('Claude PDF API returned unexpected response shape');
  }
  return content.text;
}

// ─────────────────────────────────────────────────────────
// [BOEK-COST] Image downscaling before Claude
// ─────────────────────────────────────────────────────────
//
// WHY: real usage data (2026-07) showed ~21,000 tokens per attachment —
// ~4× our estimate — because camera photos of invoices are sent at full
// resolution. Claude charges (width × height) / 750 tokens for an image, so a
// 12-megapixel phone photo is ~16,000 image tokens. Capping the long edge at
// 1568px (Anthropic's recommended max) brings that to ~1,600 tokens: a ~90%
// cut on image cost with NO provider change and NO accuracy loss — 1568px on
// an A4 page is ~185 DPI, well above the ~150 DPI needed to read invoice
// figures reliably.
//
// SAFETY (this decides whether Claude reads the amounts correctly):
//   · Only DOWNSCALE, never upscale — a small image is left untouched.
//   · 1568px long edge, JPEG quality 88 — deliberately conservative so digits
//     stay crisp. We are NOT chasing the smallest file; we're removing waste.
//   · FAIL-SAFE: any error (sharp missing, decode failure) returns the ORIGINAL
//     base64 unchanged. Cost optimisation must never drop or corrupt an invoice.
//   · SAFECORE downstream still validates ex+btw=total, so even in the unlikely
//     event a resize hurt a digit, the arithmetic check is a second net.
//
// Returns { data, mimeType }. When resized, mimeType becomes image/jpeg.
async function downscaleImageIfNeeded(
  base64: string,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
): Promise<{ data: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' }> {
  const MAX_EDGE = 1568
  const JPEG_QUALITY = 88

  try {
    // [BOEK-COST] sharp is a native, server-only module. ai.ts is (currently)
    // imported by some client components too, so we must ensure sharp is never
    // pulled into the browser bundle. Two defences:
    //   1. next.config: serverExternalPackages: ['sharp'] (the official fix)
    //   2. this runtime guard — if we're somehow on the client, skip resizing.
    // Either alone prevents the "module not found" build error; together they're
    // safe. On the client we just send the original (fail-safe path).
    if (typeof window !== 'undefined') {
      return { data: base64, mimeType }
    }

    // Dynamic import so a missing `sharp` can't break the module at load time —
    // if it's unavailable we simply skip resizing (fail-safe below).
    const sharpModule = await import('sharp').catch(() => null)
    if (!sharpModule) {
      console.warn('[BOEK-COST] sharp unavailable — sending image at original size')
      return { data: base64, mimeType }
    }
    const sharp = sharpModule.default ?? sharpModule

    const clean = base64.includes(',') ? base64.split(',')[1] : base64
    const inputBuffer = Buffer.from(clean, 'base64')

    const img = sharp(inputBuffer, { failOn: 'none' })
    const meta = await img.metadata()
    const w = meta.width ?? 0
    const h = meta.height ?? 0

    // Already within budget → don't touch it (no upscaling, no re-encode).
    if (w > 0 && h > 0 && w <= MAX_EDGE && h <= MAX_EDGE) {
      return { data: base64, mimeType }
    }

    const outBuffer = await img
      .rotate() // respect EXIF orientation so text isn't sideways
      .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer()

    const beforeKB = Math.round(inputBuffer.length / 1024)
    const afterKB = Math.round(outBuffer.length / 1024)
    // Rough token proxy: image tokens ≈ (w×h)/750. Log both for verification.
    const beforeTok = w && h ? Math.round((w * h) / 750) : null
    console.log('[BOEK-COST] Image downscaled', {
      from: `${w}x${h}`,
      to: `≤${MAX_EDGE}`,
      beforeKB,
      afterKB,
      approxTokensBefore: beforeTok,
    })

    return { data: outBuffer.toString('base64'), mimeType: 'image/jpeg' }
  } catch (err) {
    // FAIL-SAFE: never let a resize error drop or corrupt an invoice image.
    console.warn('[BOEK-COST] Image downscale failed — sending original', err)
    return { data: base64, mimeType }
  }
}

// ─────────────────────────────────────────────────────────
// Image caller — sends image to Claude (for scanned invoices)
// [BOEK-011] handles image/jpeg, image/png, image/webp — May 2026
// ─────────────────────────────────────────────────────────
async function callClaudeWithImage(
  imageBase64: string,
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
  prompt: string,
  systemPrompt: string,
  model: string = CLAUDE_MODEL
): Promise<string> {
  // [BOEK-011] Fix: clean base64 before sending — removes prefix and normalizes encoding
  const cleanData = cleanBase64(imageBase64)

  // [BOEK-COST] Downscale oversized photos before Claude sees them — the single
  // biggest cost lever (real data: ~21k → ~1.6k image tokens). Fail-safe:
  // returns the original untouched on any error, so an invoice is never lost.
  const { data: sendData, mimeType: sendMime } = await downscaleImageIfNeeded(
    cleanData,
    mimeType
  )

  // [COST-GUARD] Reserved AFTER the downscale, so the fuse is charged the real
  // (reduced) size rather than the raw photo — the cost lever above is worth
  // ~13× on image tokens and the ceiling should reflect that, not punish it.
  const budget = await reserveAiBudget({
    inputTokens: TOKEN_ESTIMATE.imageDocument,
    maxOutputTokens: MAX_TOKENS,
    label: 'callClaudeWithImage',
  })
  if (!budget.allowed) throw new Error(AI_BUDGET_EXHAUSTED_ERROR)

  const response = await fetchWithRetry(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',  // [BOEK-018] fix: API key was missing
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      system: cacheableSystem(systemPrompt),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: sendMime,
                data: sendData,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    }),
  }, 'Claude Image API');

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude Image API error ${response.status}: ${error}`);
  }

  const data = await response.json();
  // [COST-GUARD] The downscale already cut the image tokens ~13×; this cuts the
  // reservation down to what the downscaled call actually used.
  await settleAiBudget({ reserved: budget, usage: data?.usage, label: 'callClaudeWithImage' })
  const content = data.content?.[0];
  if (!content || content.type !== 'text') {
    throw new Error('Claude Image API returned unexpected response shape');
  }
  return content.text;
}

// Safe JSON parse — returns null on failure instead of throwing
function safeParseJSON<T>(text: string): T | null {
  // [BOEK-011 double-check m.2] Robust extraction. Claude is told to return
  // JSON only, but occasionally wraps it in prose ("Here is the analysis: {…}
  // Note: …") or adds a trailing comma. A naive JSON.parse then fails →
  // FALLBACK → a real invoice is silently dropped. So:
  //   1. strip code fences
  //   2. if that doesn't parse, extract the widest {…} span and try that
  //   3. as a last resort, remove trailing commas before } or ]
  const stripped = text.replace(/```json|```/g, '').trim();

  const tryParse = (s: string): T | null => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return null;
    }
  };

  // 1. Direct parse of the fence-stripped text.
  let out = tryParse(stripped);
  if (out) return out;

  // 2. Widest {…} span — handles leading/trailing prose around the JSON.
  const first = stripped.indexOf('{');
  const last = stripped.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    const span = stripped.slice(first, last + 1);
    out = tryParse(span);
    if (out) return out;

    // 3. Last resort: drop trailing commas (",}" / ",]") then retry.
    const noTrailingCommas = span.replace(/,(\s*[}\]])/g, '$1');
    out = tryParse(noTrailingCommas);
    if (out) return out;
  }

  return null;
}

// ─────────────────────────────────────────────────────────
// 1. Classify a document or invoice (metadata only — fast)
// [BOEK-018] classifyDocument — May 2026
// Used by: BOEK-010 (file system upload — no binary available)
// Note: for email attachments use verifyInvoiceFromPdf instead
// ─────────────────────────────────────────────────────────
export async function classifyDocument(
  fileContent: string,
  fileName: string
): Promise<ClassifyDocumentResult> {
  const FALLBACK: ClassifyDocumentResult = { type: 'unknown', confidence: 0 };

  try {
    const systemPrompt = `${SYSTEM_BASE}

You classify financial documents. Return only a JSON object with these exact keys:
{
  "type": "invoice" | "receipt" | "quote" | "reminder" | "ad" | "unknown",
  "confidence": number between 0 and 1,
  "vendor": string or null,
  "amount": number or null,
  "date": "DD-MM-YYYY" or null,
  "isDuplicate": boolean
}`;

    const prompt = `Classify this document.
File name: ${fileName}
Content (first 2000 chars): ${fileContent.slice(0, 2000)}

Classify as:
- invoice: has invoice number, amount, sender, receiver
- receipt: proof of payment, no invoice number required
- quote: offerte, aanbieding, prijs opgave
- reminder: herinnering, aanmaning
- ad: reclame, marketing, nieuwsbrief
- unknown: cannot determine

Return JSON only.`;

    const result = await callClaude(prompt, systemPrompt);
    const parsed = safeParseJSON<ClassifyDocumentResult>(result);
    if (!parsed) return FALLBACK;

    parsed.confidence = Math.min(1, Math.max(0, parsed.confidence ?? 0));
    return parsed;
  } catch (error) {
    console.error('[BOEK-018] classifyDocument failed:', error);
    return FALLBACK;
  }
}

// ─────────────────────────────────────────────────────────
// 2. Verify invoice by reading actual PDF or image content
// [BOEK-011] verifyInvoiceFromPdf — May 2026
//
// This is the real verification — Claude reads the actual file.
// Used by: BOEK-011 (email pipeline — after fetching attachment)
//
// Flow:
//   PDF  → callClaudeWithPdf  (reads text + scanned)
//   image → callClaudeWithImage (reads photo of invoice)
//
// Returns is_invoice: false → file is discarded, never saved to DB
// Returns is_invoice: true  → file is saved with extracted data
// ─────────────────────────────────────────────────────────
// [TRANSIENT-RETRY] Distinguish a TRANSIENT infra failure (Claude 429/5xx, network) from a
// genuine "can't read this file" verdict. On transient errors the email-sync path must NOT record
// a permanent 'could_not_read' skip and advance the watermark past a real invoice — it must retry
// next sync. Detected from the error the callClaude* helpers throw (`... API error <status>`) and
// node/undici network failures. Pure.
export function isTransientAiError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  if (/\bAPI error\s+(429|5\d\d)\b/i.test(msg)) return true;          // Claude 429 / 5xx
  if (/request failed/i.test(msg)) return true;                       // fetchWithRetry fallback
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|und_err|network|timeout/i.test(msg)) return true;
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause;
  const code = typeof cause?.code === 'string' ? cause.code : '';
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|UND_ERR/i.test(code)) return true;
  // [LEZER-KLOK] Our own deadline, however it reaches here. The relabelled message above already
  // matches /timeout/, but an abort that escapes by another path must not read as a bad document:
  // a held attachment is retried, a poison-pilled one is written off forever.
  if (isAbortError(error)) return true;
  return false;
}

// [REREAD-STRONG] Any Claude HTTP API error (the callClaude* helpers throw `Claude … API error
// <status>`), including a NON-transient 404 (model not enabled) / 400 / 403. Distinct from a
// genuine "not an invoice" verdict, which is a normal return — never an exception. Used so an
// infra/config failure surfaces honestly (retry / 502) rather than as a false document verdict.
export function isAiApiError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '');
  return /\bapi error\b/i.test(msg);
}

/**
 * [E-FACTUUR-XML] The supplier's own statement, in the shape every caller of the reader expects.
 *
 * confidence is 1, and that is a fact about provenance rather than flattery: not one value here was
 * inferred. A lower score would make the gates downstream hold the most certain document this app
 * can receive.
 *
 * `_einvoice` is written exactly as the PDF path writes it, with contradicts:false — a fact, not an
 * assumption, because the stored figures ARE the XML and there is no reading for them to disagree
 * with. [E-FACTUUR-BESLECHT] reads that key to stand the money gates down, and without it the
 * invoice nobody read would be trusted LESS than one a model had read.
 */
function eInvoiceVerification(f: EInvoiceFigures): VerifyInvoiceResult {
  return {
    is_invoice: true,
    confidence: 1,
    vendor: f.vendorName ?? undefined,
    invoice_number: f.invoiceNumber ?? undefined,
    // normalizeToIso accepts ISO as well as the Dutch notation, so the ISO day travels unchanged.
    invoice_date: f.invoiceDate ?? undefined,
    due_date: f.dueDate ?? undefined,
    total_inc_btw: f.totalIncBtw,
    total_ex_btw: f.totalExBtw,
    btw_amount: f.btwAmount,
    amount: f.totalIncBtw,
    vendor_iban: f.vendorIban ?? undefined,
    payment_reference: f.paymentReference ?? undefined,
    is_credit_note: f.isCreditNote,
    is_statement: false,
    is_reminder: false,
    document_kind: 'invoice',
    reason: `e-factuur (${f.syntax === 'ubl' ? 'Peppol/UBL' : 'Factur-X/CII'}) — bedragen door de leverancier zelf meegestuurd`,
    field_confidence: {
      vendor: 1, invoice_number: 1, invoice_date: 1, amount: 1,
      _einvoice: { ...f, contradicts: false },
    },
  } as VerifyInvoiceResult;
}

export async function verifyInvoiceFromPdf(
  fileBase64: string,
  mimeType: string,
  filename: string,
  // [BRIDGE-EXTRACT] Who WE are — the receiver of this incoming invoice. When
  // provided, the AI must never return this name as the vendor (it's the client,
  // not the sender). Fixes the W.Ketels/Kiwi confusion. Optional → callers that
  // don't pass it keep the old behaviour.
  receiverName?: string | null,
  // [TRANSIENT-RETRY] Opt-in: when true, re-throw a transient infra error instead of returning the
  // confidence-0 FALLBACK, so the email-sync/reimport path can retry rather than permanently skip.
  // Default false → every existing caller (upload / intake / bank-attach) keeps the FALLBACK behaviour.
  // [REREAD-STRONG] `model` overrides the reader model (default Haiku); `preferRawPdf` skips the
  // cheap flattened-text path and reads the ACTUAL PDF layout directly. Used by the manual
  // "Opnieuw inlezen" so a stuck complex invoice (statiegeld/retour, net-negative creditnota) is
  // re-read by a stronger model on the real page — the automatic sync keeps the Haiku/text path.
  // [RECEIVER-IDENTITY] Our own legal identity (KVK/BTW/IBAN), so the AI can tell OUR numbers
  // from the vendor's and never return ours as the vendor. Also used as a programmatic backstop
  // below (any vendor field equal to ours is dropped). Optional → callers that don't pass it keep
  // the name-only behaviour.
  // [READING-MEMORY] A block naming the suppliers whose invoices this owner has repeatedly had to
  // correct BY HAND after a previous read, and which field. Built by reading-memory.ts from the
  // audit trail; it names fields only, never amounts. Injected into the USER prompt below rather
  // than the system prompt, which is cache-marked and identical for every owner — per-owner text
  // there would miss the cache on every call. Optional: absent → the reader behaves exactly as
  // before, which is also what happens when the memory could not be loaded.
  opts?: {
    throwOnTransient?: boolean; model?: string; preferRawPdf?: boolean
    receiverKvk?: string | null; receiverBtw?: string | null; receiverIban?: string | null
    readingHint?: string | null
    // [EIGEN-NUMMER] Find the owner's OWN outgoing invoice by number (own-invoice-lookup.ts).
    // The reader stays free of database imports; each door binds the callback to its own client.
    // Absent → only the identity guard runs, exactly as before.
    lookupOwnInvoice?: (invoiceNumber: string) => Promise<{
      invoiceNumber?: string | null; totalIncBtw?: number | null; clientName?: string | null
    } | null>
  }
): Promise<VerifyInvoiceResult> {
  const FALLBACK: VerifyInvoiceResult = {
    is_invoice: false,
    confidence: 0,
    reason: 'AI verificatie mislukt — bestand overgeslagen',
  };

  // [RECEIVER-IDENTITY] Canonicalize our own identity the SAME way the vendor fields are
  // normalized below, so the equality backstop compares like-for-like.
  const myKvk = (() => {
    const d = String(opts?.receiverKvk ?? '').replace(/\D/g, '')
    return d.length === 8 ? d : null
  })();
  const myBtw = (() => {
    const b = String(opts?.receiverBtw ?? '').replace(/\s+/g, '').toUpperCase()
    return /^NL\d{9}B\d{2}$/.test(b) ? b : null
  })();
  const myIban = (() => {
    const s = String(opts?.receiverIban ?? '').replace(/\s+/g, '').toUpperCase()
    return s.length >= 15 && /^[A-Z0-9]+$/.test(s) ? s : null
  })();

  // [BRIDGE-EXTRACT] Inject the receiver identity into the prompt when known.
  const receiverIdLines = [
    myKvk ? `- Our own KVK is "${myKvk}" — this is the RECEIVER's KVK. NEVER return it as "vendor_kvk".` : '',
    myBtw ? `- Our own BTW number is "${myBtw}" — the RECEIVER's. NEVER return it as "vendor_btw".` : '',
    myIban ? `- Our own IBAN is "${myIban}" — the RECEIVER's account. NEVER return it as "vendor_iban".` : '',
  ].filter(Boolean).join('\n');
  const receiverHint = receiverName
    ? `\n\nIMPORTANT — who the RECEIVER is:
- The recipient of this invoice is "${receiverName}" (this is OUR company, the client).
- "${receiverName}" is the RECEIVER, never the vendor/sender. Even if this name appears
  prominently (e.g. under "Factuur aan", "T.a.v.", or at the top), do NOT return it as "vendor".
- The vendor is the OTHER party — the company that issued and sent the invoice to us.${receiverIdLines ? '\n' + receiverIdLines + '\n- The vendor\'s KVK/BTW/IBAN are DIFFERENT numbers than ours above.' : ''}`
    : (receiverIdLines
      ? `\n\nIMPORTANT — our own legal identity (the RECEIVER, never the vendor):
${receiverIdLines}
- The vendor's KVK/BTW/IBAN are DIFFERENT numbers than ours above; never return ours as the vendor's.`
      : '');

  const systemPrompt = `${SYSTEM_BASE}

You verify whether a document is a real commercial invoice.
Return only a JSON object with these exact keys:
{
  "is_invoice": boolean,
  "confidence": number between 0 and 1,
  "vendor": string or null,
  "invoice_number": string or null,
  "invoice_date": "YYYY-MM-DD" or null,
  "due_date": "YYYY-MM-DD" or null,
  "payment_term_days": number or null,
  "vendor_iban": string or null,
  "vendor_kvk": string or null,
  "vendor_btw": string or null,
  "payment_reference": string or null,
  "document_kind": "invoice" | "receipt" | "other",
  "is_paid": boolean,
  "paid_method": "bank" | "kas" | "pin" | null,
  "paid_date": "YYYY-MM-DD" or null,
  "paid_evidence": string or null,
  "paid_card_last4": string or null,
  "is_credit_note": boolean,
  "has_assurantiebelasting": boolean,
  "tax_kind": "inkomstenbelasting" | "zorgverzekeringswet" | "omzetbelasting" | "motorrijtuigenbelasting" | "overig" | null,
  "has_btw_verlegd": boolean,
  "is_statement": boolean,
  "is_reminder": boolean,
  "reminder_of_invoice_number": string or null,
  "total_ex_btw": number or null,
  "btw_amount": number or null,
  "total_inc_btw": number or null,
  "total_printed": number or null,
  "btw_breakdown": [{ "rate": 0 | 9 | 21, "base": number, "btw": number }] or null,
  "invoice_lines": [{ "description": string, "quantity": number or null, "unit_price": number or null, "btw_rate": 0 | 9 | 21, "amount": number }] or null,
  "currency": string or null,
  "btw_rate": 0 | 9 | 21 or null,
  "field_confidence": {
    "vendor": number between 0 and 1,
    "invoice_number": number between 0 and 1,
    "invoice_date": number between 0 and 1,
    "amount": number between 0 and 1
  },
  "reason": string or null
}

Insurance premium tax (assurantiebelasting) — read carefully, this is money:
- If the document prints "assurantiebelasting" (insurance premium tax), set
  "has_assurantiebelasting": true and set "btw_amount" to 0.
- Assurantiebelasting looks like BTW — the same euros, often 21% — but it is NOT BTW and may
  never be reclaimed. An insurance premium (polis, verzekering, "Overzicht van uw verzekeringen")
  carries assurantiebelasting, never deductible BTW. Never put that amount in "btw_amount".
- Everything else on such a document is read normally (vendor, total_inc_btw, dates).

BTW verlegd (reverse charge) — a different thing, and also money:
- If the document says the BTW is shifted to the recipient — "btw verlegd", "verleggingsregeling",
  "btw verlegd naar de aannemer", "artikel 24b", "reverse charge" — set "has_btw_verlegd": true.
- Such an invoice carries NO BTW: "btw_amount" is 0 and there is no rate on it. Do NOT compute one,
  and do NOT put a percentage in "btw_rate" — the rate follows from what was supplied, which is not
  something the document states. Leave "btw_rate" null.
- This is common in construction and staff hire: a subcontractor invoices the main contractor
  without BTW. Read the amounts exactly as printed; the app handles the rest.
- If the document DOES charge BTW, this is false, whatever the terms and conditions mention.

Rules for is_invoice = true:
- Must have a sender (vendor/company name)
- Must have a monetary amount
- Must be a request for payment OR proof of payment
- Can be: factuur, rekening, nota, bon, receipt, invoice

Vendor (sender) extraction rules — read carefully:
- "vendor" = the party that ISSUED and SENT the invoice (the supplier/leverancier).
  Usually shown in the header, near the logo, or labelled "Afzender" / "Factuur van".
- The RECEIVER/client (labelled "Factuur aan", "T.a.v.", "Aan", "Klant") is NOT the vendor.
- Never merge two names into one (e.g. do NOT output "Ketels/Kiwi" or "Atapack Kiwi").
  Return ONLY the sender's name.
- If sender and receiver are ambiguous, the vendor is the one whose bank/IBAN, KVK and
  BTW number appear as the party to be PAID — not the party being billed.

Invoice number extraction rules:
- The factuurnummer is the invoice's OWN identifier — usually the longest
  standalone number on the document (often 6+ digits, e.g. 26302362), printed
  next to a label like "Factuurnummer", "Factuur nr", "Invoice no", "Nr",
  "Referentie". Prefer the value directly tied to such a label.
- Do NOT confuse it with other numbers on the page:
  · PAGE indicators ("Pagina", "Page", "Blad", "Pag.") — a value like "1-1",
    "1 van 2", or "Pagina 1/3" is a PAGE number, never the invoice number.
  · Debiteurnummer / Klantnummer (customer number).
  · Ordernummer / Bestelnummer (order number).
  · Dates, KVK, BTW, or IBAN numbers.
- In crowded tables (many numbers close together), the page indicator often
  sits near "Pagina"; the real factuurnummer is the longer number tied to the
  invoice-number label, NOT the small "1-1"-style page value next to "Pagina".
- If you genuinely cannot find a clear invoice number (only a page/customer/
  order number is present), set invoice_number to null — never substitute one
  of those other numbers.

Vendor IBAN + payment reference extraction rules:
- "vendor_iban" = the bank account number (IBAN) of the VENDOR — the party to
  be PAID. It belongs to the SENDER/supplier, NOT to us (the receiver). It is
  usually near labels like "IBAN", "Rekeningnummer", "Bankrekening", "t.n.v.",
  or in the payment/footer block. A Dutch IBAN looks like "NL00BANK0123456789"
  (2 letters + 2 digits + 4 letters + 10 digits); foreign IBANs vary in length.
- Return the IBAN WITHOUT spaces, in UPPERCASE (e.g. "NL37BNGH0123456789").
- If MULTIPLE IBANs appear, prefer the one tied to the vendor / "to be paid".
  If you cannot tell which IBAN belongs to the vendor, set vendor_iban to null
  — never guess an IBAN, and never return our own (receiver) IBAN.

Vendor legal-identity extraction rules (the SENDER's KVK + BTW — never ours):
- "vendor_kvk" = the VENDOR's Chamber-of-Commerce number, labelled "KVK", "K.v.K.",
  "KvK-nummer", "Chamber of Commerce", "CoC". Digits only, drop spaces/dots
  (e.g. "KVK: 12 34 56 78" → "12345678"). It is the SENDER's, usually in the header
  or footer near their address — NOT the receiver's (T.a.v./Factuur aan) number.
- "vendor_btw" = the VENDOR's BTW/VAT number, labelled "BTW", "BTW-nr", "BTW-nummer",
  "VAT", "Btw-id". Dutch format NL + 9 digits + B + 2 digits; remove spaces, uppercase
  (e.g. "BTW: NL 123456789 B01" → "NL123456789B01"). The receiver's own BTW number is
  often printed too ("Uw BTW-nummer") — return the SENDER's, never the receiver's.
- If a number clearly belongs to the receiver/client, or you cannot tell, set it to null —
  never guess, never return the receiver's KVK/BTW.
- "payment_reference" = the betalingskenmerk / structured payment reference the
  invoice asks you to quote when paying (labels: "Betalingskenmerk",
  "Kenmerk", "Referentie", "Mededeling", "Payment reference"). This is often
  DIFFERENT from the invoice number. If only an invoice number is given as the
  reference, set payment_reference to null (the system falls back to the invoice
  number). If genuinely absent, set it to null — never invent one.

Rules for is_invoice = false:
- Marketing emails, newsletters, ads
- Order confirmations WITHOUT a payment amount
- Shipping notifications
- Anything that is not a financial document
- Set reason to a short Dutch explanation why it was rejected

CRITICAL — a STATEMENT OF ACCOUNT is NOT a bookable invoice (set is_invoice=false AND is_statement=true):
- A "Rekeningoverzicht", "Openstaande posten", "Openstaande facturen", "Saldo-overzicht",
  "Overzicht openstaande facturen", "Aanmaning" or "Betalingsherinnering" that LISTS MULTIPLE
  invoices is an OVERVIEW, not a single invoice. Tell-tale signs, any of which is decisive:
  · a title containing "overzicht", "openstaand", "openstaande facturen", "aanmaning" or "herinnering";
  · a TABLE whose columns are things like "Nummer / Datum / Bedrag / Betaald / Rest / V.Dagen"
    or "Factuurnummer / Factuurbedrag / Reeds betaald / Nog openstaand / Vervallen / Factuurdatum";
  · TWO OR MORE different invoice/document numbers, each with its OWN amount and date
    (including credit lines like a CR-number with a negative amount);
  · a "Totaal openstaand bedrag", "Balans" or "Saldo" line that is the SUM of the listed lines.
- Booking such a document as one invoice is a SERIOUS error: its total DOUBLE-COUNTS the
  individual invoices it summarises (which arrive separately), and it has no single valid
  BTW breakdown (excl + BTW will never equal the total). So: is_invoice=false, is_statement=true,
  document_kind="other", and reason e.g. "Rekeningoverzicht — overzicht van meerdere
  facturen, geen boekbare factuur".
- Set is_statement=false for a normal single invoice, a single collective invoice
  (verzamelfactuur: ONE invoice number covering multiple delivery lines), and a receipt.
- Exception: a reminder that repeats ONE single invoice (one number, one amount, one date)
  IS that invoice — set is_invoice=true and extract it normally. BUT also set is_reminder=true
  and put the ORIGINAL invoice number in reminder_of_invoice_number, because the original was
  very likely already received earlier — booking the reminder as a second invoice would
  double-count. Signs of a single-invoice reminder: a "Betalingsherinnering", "Herinnering",
  "Aanmaning", "2e/laatste herinnering" or "Reminder" heading above what is otherwise ONE
  invoice's details (one number, one amount). Extract the ORIGINAL invoice's amount, NOT any
  added herinneringskosten line, as the total. (The rule ABOVE — is_invoice=false — is ONLY
  for an overview of TWO OR MORE invoices.)
- The Dutch escalation ladder counts as a reminder at EVERY rung, not just the first two.
  Set is_reminder=true for any of: "Betalingsherinnering", "Herinnering", "Herinneringsnota",
  "Aanmaning", "Laatste aanmaning", "Sommatie", "Ingebrekestelling", "WIK-brief",
  "14-dagenbrief", "Aanzegging", "Laatste waarschuwing", an incassobrief or a
  deurwaarder/incassobureau letter, or their English equivalents ("Reminder",
  "Final notice", "Dunning letter"). They all concern an invoice the recipient should already
  have, so none of them is ever a NEW cost.
- reminder_of_invoice_number is IMPORTANT, not decoration: it is how we check whether the
  original invoice is already booked. Always fill it with the ORIGINAL invoice's number when the
  document names one — even when that number appears only in a sentence like
  "betreft factuur 2026-0041" or "onze factuur 2026-0041 d.d. 3 maart".
- For anything that is NOT a reminder, set is_reminder=false and reminder_of_invoice_number=null.

A letter from the BELASTINGDIENST (tax office) — set "tax_kind" (ALWAYS set this key):
- When the sender is the Belastingdienst (also "Belasting dienst", "Ministerie van Financiën /
  Belastingdienst", a letter with an "aanslagnummer" and a "betalingskenmerk"), it IS a payable
  (is_invoice=true, document_kind="invoice", vendor="Belastingdienst", extract the amount, the
  IBAN, the betalingskenmerk and the due date as usual) — but it is NOT a purchase, so name the
  tax it concerns in "tax_kind":
    · "inkomstenbelasting"       — "Voorlopige aanslag inkomstenbelasting", "Aanslag IB", "IB/PVV"
    · "zorgverzekeringswet"      — "Zorgverzekeringswet", "Zvw", "bijdrage Zvw"
    · "omzetbelasting"           — "Naheffingsaanslag omzetbelasting", "btw", "OB"
    · "motorrijtuigenbelasting"  — "Motorrijtuigenbelasting", "MRB", "wegenbelasting"
    · "overig"                   — any other Belastingdienst letter with an amount to pay
  A letter that combines IB and Zvw on one aanslag: use "inkomstenbelasting".
- Such a letter has NO btw: btw_amount=0, total_ex_btw = total_inc_btw = the amount to pay.
- For every other sender, tax_kind=null. Never guess a kind for a supplier that merely mentions
  tax on its invoice.

Document kind + paid status (ALWAYS set these):
- "document_kind" tells what this is:
  - "invoice": a payment REQUEST — has an invoice number, a vendor, a due date
    or payment terms ("te betalen", "betaal binnen 14 dagen", an IBAN to pay to).
    Usually NOT yet paid.
  - "receipt": a PROOF OF PAYMENT already made — a kassabon, pin-receipt, or
    cash receipt. Signs: "PIN", "Contant", "Betaald", "Voldaan", a store till
    receipt layout, no invoice number / no payment request, paid on the spot.
  - "other": not an invoice and not a receipt (newsletter, quote, reminder,
    shipping note, contract). For "other", set is_invoice=false too.
- "is_paid": true ONLY when the document shows the payment is ALREADY DONE
  (a receipt/kassabon: "PIN", "Contant betaald", "Voldaan", "Betaald"). For a
  normal unpaid invoice (a request to pay), set is_paid=false. When unsure,
  set is_paid=false — it is safer to ask the human to confirm payment than to
  mark something paid that is not.
- HANDWRITTEN / STAMPED PAYMENT MARKS: a business owner often processes a PAPER invoice by
  WRITING on it with pen or applying a shop STAMP — e.g. "betaald", "voldaan", "contant",
  "kas", "bank", "pin", a bank/giro note, and/or a DATE. Read these marks even though they are
  handwritten or stamped (they may be in a corner, diagonal, or over the print). When such a
  mark clearly indicates the invoice was PAID, set is_paid=true and fill:
    · "paid_method": "bank" (giro/overschrijving/"bank"), "kas" (contant/cash/"kas"),
      "pin" (pin/card), or null if the method isn't written.
    · "paid_date": the written/stamped payment date as "YYYY-MM-DD", or null if no date is written.
  If there is NO such mark, set is_paid=false, paid_method=null, paid_date=null. Do NOT infer
  payment from an unmarked invoice. A printed "te betalen"/due date is NOT a payment mark.
- A receipt is still a real financial document: keep is_invoice=true for both
  "invoice" and "receipt" (both enter the pipeline); only "other" is false.
- [BON-BETAALWIJZE] PRINTED TENDER LINE ON A KASSABON. The rule above is about HANDWRITTEN
  marks on an invoice. A till receipt does not need one: it PRINTS how it was settled, and that
  is the accountant's first question about a receipt — the one he cannot derive himself, because
  a cash purchase leaves no bank line. Read that block and fill:
    · "paid_evidence": the tender line(s) COPIED VERBATIM, e.g. "Bankpas 70,29",
      "Kontant 10,75 / Wisselgeld 0,00", "KONTANT 120,00 Afronding 0,02 Wisselgeld 7,10",
      "PIN leesmethode CTL CHIP / Betaling gelukt". Copy what is printed — do NOT summarise it
      and do NOT translate it. Null when the receipt prints no tender line at all.
    · "paid_card_last4": the last 4 digits of the card when a masked card number is printed
      ("Kaart xxxxxxxxxxxxxxxx6596" → "6596"). Null otherwise. Never invent digits.
    · "paid_method": "bank" for a card payment (Bankpas, PIN, Maestro, V PAY, contactloos,
      creditcard), "kas" for contant/kontant/cash, null when the receipt does not say.
  A card payment is "bank" even when the word "bank" does not appear — a pinpas settles on the
  bank account. When BOTH a cash tender and a card tender are printed (a split payment), still
  copy both into paid_evidence and set paid_method=null: a human decides that one.
- [BON-NUMMER] A kassabon usually DOES carry a printed reference, just not called "factuurnummer"
  — "BON: 2/667957", "Bon 4/744768", "Transactie 049612", "Volgnr. 0001", a receipt/ticket
  number. Put that printed reference in "invoice_number". It is the only identifier the document
  actually has, and it is what makes a re-photographed bon recognisable as the same one. Leave
  invoice_number null only when the receipt truly prints no reference at all — never invent one.

Creditnota detection (ALWAYS set is_credit_note):
- "is_credit_note" = true ONLY on explicit evidence this is a CREDIT NOTE:
  a title like "Creditnota", "Credit note", "Creditfactuur", "Credit invoice";
  an INVOICE CORRECTION — "Factuurcorrectie", "Factuurcorrectienummer",
  "Gecorrigeerd factuurdocument", "Correctiereden", "Credit memo", a "CM-…"
  number prefix, a return/refund ("Full return", "Retour", "Terugbetaling");
  an invoice number with a credit prefix (e.g. "CR-…"); or the amounts printed
  as NEGATIVE / explicitly marked as credit ("te ontvangen", "credit").
  A document that CORRECTS or REVERSES an earlier invoice (it names the original
  invoice it corrects) with negative amounts IS a creditnota — set it true.
- A creditnota is still a real financial document: is_invoice=true and
  document_kind="invoice" (it enters the same verify queue).
- On a creditnota, return the amounts EXACTLY as printed — NEGATIVE when the
  document shows them negative (e.g. total_inc_btw: -4.84). NEVER flip a sign
  yourself: report what the document states. If a document is titled creditnota
  but prints positive amounts, return them positive (the system will hold it
  for human review — that is correct).
- A normal invoice → is_credit_note = false. When unsure → false.

Statement / reminder detection (NOT an invoice — prevents double counting):
- A "Rekeningoverzicht", "Aanmaning", "Betalingsherinnering", "Herinnering",
  "Saldo-overzicht", "Openstaande posten" or any account statement / dunning
  letter is NOT an invoice. It SUMMARIZES invoices that already exist as
  separate documents — importing it as an invoice would count those amounts
  TWICE and could make the owner pay twice. → is_invoice=false,
  document_kind="other", and set reason to a short Dutch explanation, e.g.
  "rekeningoverzicht — samenvatting van bestaande facturen, geen factuur".
- Strong signals — ANY ONE of these is enough to classify it as a statement
  (set is_invoice=false AND is_statement=true):
  · a title/heading with "overzicht", "openstaande facturen", "openstaande
    posten", "rekeningoverzicht" or "saldo-overzicht"
  · a table listing MULTIPLE different factuurnummers in one document
  · columns like "Reeds betaald" / "Nog openstaand" / "Vervallen"
  · a total labelled "openstaand" ("Totaal openstaand bedrag", "Saldo",
    "Balans") instead of a single "Totaal incl. BTW"
- EXCEPTION: a reminder that contains exactly ONE invoice WITH a full BTW
  breakdown (excl + BTW + incl) is that invoice re-sent → treat it as a normal
  invoice (is_invoice=true, is_reminder=true; the duplicate check catches the
  copy of the original).
- Tie-break: for an OVERVIEW of two or more invoices, prefer is_invoice=false,
  is_statement=true — booking its summed total double-counts real invoices and
  can make the owner PAY TWICE. A wrongly-held overview only costs one glance in
  the skipped list; a wrongly-booked one costs money. Only when it is clearly a
  SINGLE invoice (one number, one BTW breakdown) do you default to is_invoice=true.

Amount extraction rules:
- All amounts are numeric only — no currency symbols, no thousand separators — e.g. 121.00
- total_ex_btw: the FULL amount before BTW — the sum of ALL line bases across every rate,
  INCLUDING any 0%-BTW lines. On a correctly read invoice total_ex_btw + btw_amount =
  total_inc_btw. That identity is a CONSEQUENCE of reading all three right, not a rule to
  enforce — see "IF THEY DISAGREE" below. See STATIEGELD below.
- btw_amount: the total BTW/VAT amount shown on the invoice (the sum across all rates).
- total_inc_btw: the final total the invoice asks you to pay — the "Totaal", "Te voldoen",
  "Totaalbedrag" or "Totaal te betalen" line. Return THIS printed final total even when it
  does not equal a simple product subtotal (statiegeld, emballage and shipping are added on
  top) and even when it is NEGATIVE (a return/creditnota where credited items exceed goods).
- total_printed: that same final total, copied EXACTLY as printed and never touched again —
  no rounding, no adjusting, no arithmetic of your own. null only when the invoice prints no
  single final figure at all. It is a separate field from total_inc_btw on purpose: it is the
  one number we can check your reading against.
- btw_rate: the percentage — usually 21, sometimes 9 or 0. On a MIXED invoice (e.g. 9% goods
  plus 0% statiegeld) the effective blended rate is lower; that is normal, not an error.
- If only the total is shown and BTW rate is known, calculate the breakdown
- If a value genuinely cannot be found, set it to null — never guess
- confidence: how certain you are (0 = no idea, 1 = absolutely certain)

STATIEGELD / EMBALLAGE / STORTGELD (crucial — a shop that sells drinks sees this daily):
- Many wholesale invoices add STATIEGELD (a returnable-packaging deposit), EMBALLAGE, or a
  container/"Bijgel. container"/"Retour container" charge, usually at 0% BTW, ON TOP of the
  goods. There may be a whole "Statiegeld" column, or a summary line, or a "Geen BTW" grondslag.
- These deposit amounts ARE part of what is paid. Fold them into total_ex_btw as 0%-BTW base —
  dropping them is the usual reason excl + BTW comes out below the printed total. Include the
  0% line; do NOT instead shrink the total to match a base you left it out of.
- Returned deposits are NEGATIVE (e.g. "Retour container -408,00"): include them with their
  sign. If the net printed total ("Te voldoen") is therefore negative, return it negative.

- EX/INCL identity: total_ex_btw + btw_amount MUST equal total_inc_btw. Some suppliers
  mislabel the GROSS total as "Subtotaal", so you may see the same number on both the
  "Subtotaal" and "Totaal incl. btw" lines while a real BTW is printed — that is impossible
  (equal excl and incl means zero BTW). Trust the "Totaal incl."/"Reeds betaald"/paid total
  and the printed BTW, and set total_ex_btw = total_inc_btw − btw_amount. Never return
  total_ex_btw equal to total_inc_btw when btw_amount is non-zero.

CURRENCY (currency) — copy it, never assume it:
- Return the currency code printed beside the amounts: "EUR", "USD", "GBP", "CHF", "TRY"… If the
  document shows only a symbol, return the code that symbol stands for (€ → "EUR", £ → "GBP").
- Return null when the document prints no currency at all. Null is the normal answer and it is a
  safe one — do NOT fill in "EUR" because the invoice looks Dutch. We only act on what you read.
- Return null too when the symbol could be more than one currency ("kr", a bare "$"), because a
  currency named wrongly is worse than one not named.
- WHY: every amount in this administration is a euro amount. A dollar invoice booked as euros is
  wrong by the exchange rate in the base, the btw and the aangifte, and nothing downstream can see
  it — the arithmetic on the document is perfectly consistent, in dollars.

INVOICE LINES (invoice_lines) — read them, and read the RATE that stands on each one:
- Copy each priced line as printed: its description, its amount EXCLUDING btw, and the btw rate
  stated for THAT line (0, 9 or 21). Quantity and unit price when they are printed; null when not.
- "amount" is the line total EXCLUDING btw. If a line prints only an inclusive price, leave
  "amount" null rather than dividing it yourself — a computed line is not a read one.
- If a line's rate is not stated or you are not sure which of the printed rates applies to it, set
  "btw_rate": null for that line. Do NOT spread the document's rates over the lines by guessing:
  a wrong rate on a line puts money in the wrong btw column, which is worse than no lines at all.
- Return null for the whole field when the document prints no priced lines (a bank-style nota, a
  one-line subscription invoice already covered by the totals).
- WHY THIS MATTERS: on a document with TWO rates and no summary block, the lines are the only
  thing that can corroborate the btw. We group them per rate and check that the result reproduces
  the total you read. So the lines are not decoration — they are the check.

MIXED-RATE BTW SUMMARY BLOCK (the most common mis-read on wholesale/horeca invoices):
- Dutch invoices often close with a summary printing ONE ROW PER RATE, for example:
    €  2.591,71    BTW 9% excl.     €   233,20
    €    822,21    BTW 21% excl.    €   172,70
  The number on the LEFT of such a row is the GRONDSLAG (the base taxed at that rate); the
  number on the RIGHT is the BTW charged over it. Those are two DIFFERENT columns — never add
  a grondslag and a BTW amount together, and never take one row's figure as the whole BTW.
- btw_amount = the sum of the BTW column ONLY (233,20 + 172,70 = 405,90 in the example).
- total_ex_btw = the printed "Totaal exclusief BTW" / "Ex. BTW" line, which equals the sum of
  the grondslag column (2.591,71 + 822,21 = 3.413,92).
- btw_breakdown = those rows themselves, one entry per rate row: {"rate": 9, "base": 2591.71,
  "btw": 233.20}. COPY both figures off the page — do not recompute base × rate, because a
  supplier who rounds per line drifts a few cents from that product and your recomputation
  would silently overwrite what the invoice actually says. Return null only when the invoice
  prints no such per-rate block.
- CHECK YOURSELF before answering: btw_amount MUST equal total_inc_btw − total_ex_btw
  (3.819,82 − 3.413,92 = 405,90 ✓). If your sum does not match that difference, you added the
  wrong column or missed a rate row — RECOUNT the BTW column.
- IF THEY DISAGREE: report all of it honestly and CHANGE NOTHING. Leave total_ex_btw,
  btw_amount and total_inc_btw at what you actually read, put the printed final total in
  total_printed, fill btw_breakdown, and score field_confidence.amount LOW. NEVER move one
  figure so the other two add up. A disagreement is the only evidence we get that something was
  misread; a triplet you balanced yourself passes every check we have while being wrong. That is
  not hypothetical — a mixed-rate horeca invoice was booked with a btw € 0,46 short because the
  total had been made to follow a mis-summed BTW column, and nothing anywhere could see it.
- A blended rate between the rates present (e.g. 12% across 9% and 21% lines) is NORMAL. A
  computed rate ABOVE 21% is impossible in the Netherlands and always means a mis-read.

Per-field confidence rules:
- field_confidence.vendor: how certain you are the vendor (sender) is correct.
  LOW (< 0.7) if sender/receiver were ambiguous, names were close, or the layout was unclear.
- field_confidence.invoice_number: LOW if you had to guess, or the only candidate looked
  like a page number, customer number, or date rather than a clear invoice number.
- field_confidence.invoice_date: LOW if multiple dates were present (invoice / due / delivery)
  and it was unclear which is the invoice date.
- field_confidence.amount: how certain you are the AMOUNTS (total_ex_btw / btw_amount /
  total_inc_btw) are correct. This is the most important score — it is the money. LOW
  (< 0.7) if any digit was blurry/cut off, the currency or decimal separator was unclear,
  totals were handwritten, or you had to infer a total from partial figures. A confidently
  WRONG amount is the worst outcome — when unsure, score LOW so the user is asked to check.
- due_date: the EXPLICIT due/expiry date if the invoice prints one ("Vervaldatum",
  "Te betalen voor", "Uiterste betaaldatum", "Betalen voor"). Return it as
  "YYYY-MM-DD". If no explicit due date is printed, set due_date to null — do NOT
  compute it yourself.
- payment_term_days: if the invoice states a payment TERM instead of (or besides) an
  explicit date — "Betaling binnen 14 dagen", "Te voldoen binnen 30 dagen", "14 dagen
  netto" — return the number of days as an integer (e.g. 14, 30). If no term is stated,
  set payment_term_days to null. Never invent a default term.
- Be honest. A low score is BETTER than a confident wrong answer — the user will be asked
  to confirm low-confidence fields. Do not inflate these scores.${receiverHint}`;

  // [READING-MEMORY] Appended AFTER the task, never before it: the instruction stands on its own,
  // and the memory is context for it. Empty for almost every owner — most have no supplier past the
  // threshold — so the usual prompt is byte-identical to what it was.
  const memoryBlock = typeof opts?.readingHint === 'string' && opts.readingHint.trim() ? `\n${opts.readingHint}\n` : '';
  const prompt = `Verify if this document is a real invoice or receipt.
Filename: ${filename}

Read the full content and answer:
1. Is this a real financial document that requires or confirms payment?
2. Extract the vendor, invoice number, date
3. Extract the full amount breakdown: amount excl. BTW, BTW amount, total incl. BTW, BTW rate
${memoryBlock}
Return JSON only.`;

  // [REREAD-STRONG] Reader model + read strategy. Default: undefined model (→ callClaude* use
  // Haiku) and the cheap text path. The manual re-read passes a stronger model and preferRawPdf.
  const model = opts?.model;
  const preferRawPdf = opts?.preferRawPdf === true;

  // [E-FACTUUR-XML] A Peppol / NLCIUS invoice that arrived as XML on its own — no page, no picture,
  // nothing to read. The supplier states the number, both dates, their own legal name, their
  // account and all three amounts in a structured form they produced. There is no model that could
  // improve on that, so none is asked, and no API call is made.
  //
  // It sits in THIS function, not at one of the doors, because both doors call this one: the e-mail
  // sync used to intercept it for itself, which made it the only door that could read a Peppol
  // invoice — the identical file uploaded by hand was filed as "a format we cannot read". A reader
  // on one door is not a reader; it is an inconsistency nobody can explain to the owner.
  //
  // A file that does not parse COMPLETELY is NOT booked. It comes back as not-an-invoice with
  // confidence 0, which is the ordinary could-not-read path: the file is kept, counted and named to
  // the owner. Half an e-invoice would be trusted above the model, which is worse than none.
  if (isEInvoiceXmlMime(mimeType)) {
    const figures = parseEInvoice(Buffer.from(cleanBase64(fileBase64), 'base64').toString('utf8'));
    return figures
      ? eInvoiceVerification(figures)
      : { is_invoice: false, confidence: 0, reason: 'e-factuur XML kon niet volledig worden gelezen' };
  }

  try {
    let result: string;
    // [STATEMENT-TEXT-GUARD] Kept in the outer scope so the content backstop below can read the
    // same text we (optionally) extracted for the cheap text path — an overview reliably announces
    // itself in its text even when the small model forgets to set is_statement.
    let statementText: string | null = null;

    if (mimeType === 'application/pdf') {
      // [BOEK-011] Validate PDF before sending — catch corrupt files early
      // A valid PDF base64 starts with "JVBERi0" (= "%PDF-")
      const cleaned = cleanBase64(fileBase64);
      if (!cleaned.startsWith('JVBERi0')) {
        console.warn(
          `[BOEK-011] Skipping invalid PDF "${filename}" — base64 starts with: ${cleaned.slice(0, 12)}`
        );
        return {
          is_invoice: false,
          confidence: 0,
          reason: 'Ongeldig PDF-bestand — overgeslagen',
          // [FAIR-USE §3] Dit oordeel viel VÓÓR enige Claude-aanroep — er is geen lezing
          // verbruikt. De routes geven het gereserveerde tegoed terug wanneer dit vlagje staat:
          // "mislukte pogingen komen nooit op jouw rekening" gold al voor de crash-kant (release
          // in de catch), maar niet voor dit pad, dat als gewoon resultaat terugkeert.
          no_ai_call: true,
        };
      }
      if (preferRawPdf) {
        // [REREAD-STRONG] Read the ACTUAL page layout directly on the (stronger) model — the
        // flattened-text path is exactly what loses the statiegeld/retour columns and the net-
        // negative total that a hard invoice like this needs. No text backstop here: the model
        // sees the whole document and its own is_statement guard still applies downstream.
        result = await callClaudeWithPdf(fileBase64, prompt, systemPrompt, model);
      } else {
      // [PDF-OPTIMIZE] Try the cheap text path first. For a TEXT PDF (the
      // majority of supplier invoices) we extract the text ourselves and send
      // TEXT ONLY (~840 vs ~2425 tokens, ~65% saved). SAFECORE-verified on real
      // Kiwi data: identical amounts, no "Nieuwe schuld" trap. Returns null for
      // scanned/weak PDFs or on ANY error → we fall through to the UNCHANGED raw
      // path below, so scanned invoices behave exactly as before (zero loss).
      const extractedText = await extractPdfTextIfTextLayer(fileBase64);
      statementText = extractedText;
      if (extractedText) {
        result = await callClaude(
          `${prompt}\n\n--- FACTUUR TEKST (uit PDF) ---\n${extractedText}`,
          systemPrompt,
          model
        );

        // [PDF-OPTIMIZE] SAFECORE secondary fail-safe. On real Kiwi data, a
        // FEW complex layouts (multi-column tables, credit notes) survive text
        // extraction as CHARACTERS but lose the visual column order. Reading the
        // flat text, Claude then either (a) returns an invoice with an unusable
        // total, or (b) fails to recognise it as an invoice at all — while the
        // RAW PDF path, where Claude SEES the page layout, reads it correctly.
        //
        // Rule: the text path is TRUSTED only when it yields a real invoice with
        // a usable total. ANY weaker outcome — parse failure, "not an invoice",
        // or a missing/underivable total — means we CANNOT trust the flat text,
        // so we RE-READ once via the raw PDF and use THAT result. The raw path is
        // exactly the pre-PDF-OPTIMIZE behaviour, so a re-read can never do worse
        // than production already did: zero degradation, zero invoice loss.
        //
        // Why not just check is_invoice=true+total: because a garbled layout can
        // ALSO make Claude reject a genuine invoice (case b, seen on Ketels). We
        // must catch that too, and the raw path is the trustworthy arbiter.
        //
        // Cost: the extra raw call fires only when the cheap text path did not
        // produce a solid invoice. Real PDF attachments are overwhelmingly
        // invoices, and a rejected non-invoice text call is tiny, so the rare
        // double-read is dwarfed by the saving on the clean majority.
        const probe = safeParseJSON<VerifyInvoiceResult>(result);
        const hasNum = (v: unknown): boolean =>
          typeof v === 'number' && isFinite(v);
        const textPathTrusted =
          probe != null &&
          probe.is_invoice === true &&
          (hasNum(probe.total_inc_btw) ||
            (hasNum(probe.total_ex_btw) && hasNum(probe.btw_amount)));

        // Re-read via the RAW PDF (same Haiku model) when the flat text either wasn't conclusive
        // (existing SAFECORE fallback) OR produced an invoice whose number / BTW-split / amount
        // came back weak. Reading the actual page LAYOUT recovers the table columns the flattened
        // text loses — the fix for the frequent EMAIL-<ts> placeholder numbers and "—" ex/BTW
        // splits — with no model-cost change (still Haiku).
        if (!textPathTrusted) {
          console.log(
            '[PDF-OPTIMIZE] Text path not conclusive — re-reading via raw PDF (SAFECORE fallback)'
          );
          result = await callClaudeWithPdf(fileBase64, prompt, systemPrompt, model);
        } else if (needsVisualReread(probe)) {
          console.log(
            '[VISUAL-REREAD] Text path read an invoice with weak number/split/amount — re-reading via the raw PDF layout'
          );
          const reread = await callClaudeWithPdf(fileBase64, prompt, systemPrompt, model);
          const rp = safeParseJSON<VerifyInvoiceResult>(reread);
          // Adopt the visual re-read (to gain the recovered invoice number / BTW split) ONLY when
          // its total AGREES with the total the trusted text path already read. The re-read fires
          // mostly for a missing NUMBER, so its total must confirm — not silently replace — the
          // money. If the two totals DISAGREE, keep the text read (already flagged needs-review for
          // the weak field, so the human reviews it) rather than swap in a differently-read total.
          const probeTotal = hasNum(probe.total_inc_btw)
            ? (probe.total_inc_btw as number)
            : hasNum(probe.total_ex_btw) && hasNum(probe.btw_amount)
              ? (probe.total_ex_btw as number) + (probe.btw_amount as number)
              : null;
          const rpTotal =
            rp != null && rp.is_invoice === true
              ? hasNum(rp.total_inc_btw)
                ? (rp.total_inc_btw as number)
                : hasNum(rp.total_ex_btw) && hasNum(rp.btw_amount)
                  ? (rp.total_ex_btw as number) + (rp.btw_amount as number)
                  : null
              : null;
          if (rpTotal != null && probeTotal != null && Math.abs(rpTotal - probeTotal) <= 0.02) {
            result = reread;
          }
        }
      } else {
        // Raw PDF path — Claude reads the actual PDF (text + scanned). Already the visual layout,
        // so a VISUAL-REREAD would be an identical second pass — nothing to gain.
        result = await callClaudeWithPdf(fileBase64, prompt, systemPrompt, model);
      }
      } // [REREAD-STRONG] close the non-preferRawPdf (text-path) branch
    } else if (
      mimeType === 'image/jpeg' ||
      mimeType === 'image/png' ||
      mimeType === 'image/webp' ||
      mimeType === 'image/gif'
    ) {
      // Claude reads the image directly (already the visual layout). The re-read model override is
      // honoured so the manual re-read of a photographed invoice also uses the stronger model.
      result = await callClaudeWithImage(
        fileBase64,
        mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
        prompt,
        systemPrompt,
        model
      );
    } else {
      // Unsupported type — skip safely
      return {
        is_invoice: false,
        confidence: 0,
        reason: `Bestandstype niet ondersteund: ${mimeType}`,
      };
    }

    const parsed = safeParseJSON<VerifyInvoiceResult>(result);
    if (!parsed) return FALLBACK;

    // [STATEMENT-TEXT-GUARD] Content backstop: if the extracted PDF text has the unmistakable
    // shape of an OPENSTAANDE-FACTUREN / rekeningoverzicht (plural overview vocab + a summed open
    // balance or multiple invoice rows), force is_statement=true so the early-return below rejects
    // it — regardless of what the small model put in is_invoice/is_statement. This is the
    // deterministic fix for the reported "overzicht wordt geïmporteerd" case (Exact statements are
    // text PDFs). A single-invoice reminder never matches (narrow, plural-only vocabulary).
    if (looksLikeStatementText(statementText)) {
      parsed.is_statement = true;
    }

    // [STATEMENT-GUARD] Deterministic backstop against booking a STATEMENT OF ACCOUNT as an
    // invoice. A "Rekeningoverzicht" / "Openstaande posten" / "Saldo-overzicht" lists MANY
    // invoices and a summed total — booking it as one invoice double-counts the invoices it
    // summarises and carries no valid single BTW split. The prompt already teaches this, but
    // an unmistakable filename forces the correct verdict even if the model wavers. Narrow on
    // purpose: NOT "aanmaning/herinnering", which can be a single-invoice reminder.
    if (parsed.is_invoice && isStatementFilename(filename)) {
      return {
        is_invoice: false,
        confidence: 0.9, // confident it is NOT a bookable invoice → registered with the reason
        reason: 'Rekeningoverzicht — overzicht van meerdere facturen, geen boekbare factuur',
      };
    }

    // [STATEMENT] The model flagged this as a statement of account (an overview of MULTIPLE
    // invoices with a summed balance — e.g. "OPENSTAANDE FACTUREN" with Betaald/Rest/Balans).
    // Booking its total double-counts the individual invoices, so force the verdict here and
    // return EARLY — before the confidence banding or the [TRUST-CONFIDENT-FALSE] rescue can
    // resurrect it as one bookable invoice (it has a vendor + a balance amount that would
    // otherwise pass the rescue). Registered in the skip list, so it stays visible, not booked.
    if (parsed.is_statement === true) {
      return {
        is_invoice: false,
        is_statement: true,
        confidence: Math.max(parsed.confidence ?? 0, 0.8),
        reason: parsed.reason || 'Rekeningoverzicht — overzicht van meerdere facturen, geen boekbare factuur',
      };
    }

    // Clamp confidence
    parsed.confidence = Math.min(1, Math.max(0, parsed.confidence ?? 0));

    // [BRIDGE-EXTRACT] Normalize per-field confidence (clamp 0–1; default to a
    // neutral 1 when the AI omitted a field's score so we don't false-flag).
    const clamp01 = (v: unknown): number =>
      typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    parsed.field_confidence = {
      vendor: clamp01(parsed.field_confidence?.vendor),
      invoice_number: clamp01(parsed.field_confidence?.invoice_number),
      invoice_date: clamp01(parsed.field_confidence?.invoice_date),
      // [TRUST-AMOUNTS] Only carry the amount score when the model actually gave one.
      // Unlike the fields above, we do NOT default a missing amount score to 1 —
      // "no signal" must not read as "certain" on the money-truth. import-health
      // flags it only when it is present and low, so absence fabricates no doubt.
      ...(typeof parsed.field_confidence?.amount === 'number'
        ? { amount: Math.min(1, Math.max(0, parsed.field_confidence.amount)) }
        : {}),
    };

    // [GEGROND] The one check on a money field that is not the reader checking itself.
    //
    // Everything else here asks the same model about its own answer: the arithmetic gate verifies
    // excl + btw = incl among three numbers ONE read produced, and field_confidence is its opinion
    // of its own opinion. A read that is wrong consistently passes all of it — the EUR 0,46 BTW
    // error on a real invoice was exactly that shape, and it is why an owner keeps the paper copy
    // open beside the app instead of trusting the screen.
    //
    // For a text PDF we already hold the document's own characters — we extracted them and fed them
    // TO the model — so "is this number really printed on the paper?" is answerable with no model at
    // all. Stored beside _safecore, in three states, because a check that could not RUN (a photo has
    // no text layer) must never read as one that passed, nor as one that failed.
    {
      const amounts = {
        totalIncBtw: parsed.total_inc_btw,
        totalExBtw: parsed.total_ex_btw,
        btwAmount: parsed.btw_amount,
      };
      let grounding = groundMoneyFields(amounts, statementText, 'text');
      // [STATIEGELD-GAT] Which witness ended up speaking — the document's own characters, or the
      // blind transcription below. The deposit search needs the SAME text the grounding used, and
      // tracking it here is cheaper than re-deciding which one it was afterwards.
      let witnessText: string | null = statementText;

      // [E-FACTUUR] Before any of the reading checks: does this PDF carry the invoice a SECOND
      // time, as structured XML the supplier produced? Factur-X and ZUGFeRD are ordinary-looking
      // PDFs that do exactly that, and a Dutch buyer already receives them: German suppliers send
      // ZUGFeRD now, French ones Factur-X, Belgian ones Peppol UBL since January 2026. So this
      // arrives today and will only arrive more.
      //
      // [E-FACTUUR-DATUM] What used to stand here was a Dutch mandate year, written once from an
      // unnamed source and copied into eight files. It is not true, and the sourced answer lives in
      // exactly one place — the header of src/lib/e-invoice.ts. The argument above needs no
      // deadline, which is precisely why it survives one being wrong.
      //
      // It is not another way of reading the page. Everything else here checks a READING; this is
      // the supplier's own statement of the money, in a form with nothing to interpret. When it is
      // present and self-consistent, it is the best witness the app will ever have — and when it
      // DISAGREES with what was read, that is an error no other gate in the building could catch:
      // the arithmetic would be perfect, the figure printed, and its placement exactly right.
      let eInvoice: ReturnType<typeof parseEInvoice> = null;
      if (mimeType === 'application/pdf') {
        const embedded = await extractEmbeddedInvoiceXmlDetailed(Buffer.from(cleanBase64(fileBase64), 'base64'));
        if (embedded.xml) eInvoice = parseEInvoice(embedded.xml);
        // [LEES] A factur-x.xml that would not decompress is NOT "no e-invoice" — the supplier
        // shipped their own figures and we could not open them. The reading proceeds exactly as
        // before, but the review surface gets to say that the best witness exists and is sealed.
        if (!eInvoice && embedded.unreadablePresent) {
          (parsed.field_confidence as unknown as Record<string, unknown>)._einvoice = { unreadable: true };
        }
      }
      if (eInvoice) {
        (parsed.field_confidence as unknown as Record<string, unknown>)._einvoice = {
          ...eInvoice,
          contradicts: eInvoiceContradicts(eInvoice, parsed.total_inc_btw),
        };
      }

      // [GEGROND-OCR] No text layer means no characters to search, so the check above says
      // 'unreadable' — honest, and useless, because a photographed receipt is the ordinary case this
      // app exists for. Most of what comes in would get no independent check at all.
      //
      // So for a photo we ask a SECOND, blind read to transcribe the amounts it can see, and search
      // that instead. It is a weaker witness than a text layer and the verdict records which one
      // spoke (source: 'ocr'), because presenting a model read as mechanical certainty is how a
      // green tick stops meaning anything.
      //
      // Only when the first check found nothing to work with, and only when there is a total worth
      // corroborating: this costs an API call, and spending one to re-confirm what the document's
      // own characters already proved would be paying for a worse answer.
      if (
        grounding.totalIncBtw === 'unreadable' &&
        // [E-FACTUUR] Never when the supplier's own structured figures are already in hand. OCR is
        // a second READING and this is the document itself — paying an API call to get a weaker
        // answer to a question already settled is spending money to be less sure.
        !eInvoice &&
        typeof parsed.total_inc_btw === 'number' &&
        Number.isFinite(parsed.total_inc_btw)
      ) {
        const transcribed = await transcribeAmountsForGrounding(fileBase64, mimeType, model ?? CLAUDE_MODEL);
        if (transcribed) {
          grounding = groundMoneyFields(amounts, transcribed, 'ocr');
          witnessText = transcribed;
        }
      }

      (parsed.field_confidence as unknown as Record<string, unknown>)._grounding = grounding;

      // [STATIEGELD-GAT] The deposit line the reader dropped, found back on the paper.
      //
      // The prompt spells this case out at length (STATIEGELD / EMBALLAGE above) and the model
      // still drops it — reported on Elegance Brands 2026080832, where Subtotaal 835,30 + BTW
      // 75,22 sat under a printed Totaal of 1.086,92 and the missing 176,40 stood one line above
      // it, labelled "Totaal Statiegeld". A rule the reader is ASKED to follow needs a mechanical
      // net underneath it, because on a drinks wholesaler's invoice this is not an edge case.
      //
      // Stored, never applied: the arithmetic fixes the amount and the paper names it, but what
      // gets booked as cost is the owner's to confirm — one tap on the verify screen. See
      // statiegeld.ts for why folding it into the base leaves the btw untouched.
      {
        const deposit = detectDepositGap({
          totalExBtw: parsed.total_ex_btw,
          btwAmount: parsed.btw_amount,
          totalIncBtw: parsed.total_inc_btw,
          text: witnessText,
        });
        if (deposit) {
          (parsed.field_confidence as unknown as Record<string, unknown>)._statiegeld = deposit;
        }
      }

      // [GEGROND-NAAM] And the same question about the NAME, on the same characters. Grounded
      // against `statementText` only — never against an OCR transcription, because that
      // transcription is asked for the AMOUNTS and finding no name in it would say nothing.
      //
      // The name is not a label: invoices.client_name is the identity key knownIbanForVendor uses,
      // and that check is what stands between the owner and a payment redirected to a stranger. A
      // name read as a DIFFERENT company does not fail it — it looks up a different supplier and
      // passes clean.
      (parsed.field_confidence as unknown as Record<string, unknown>)._vendorGrounding = {
        verdict: groundVendorName(parsed.vendor, statementText),
        name: typeof parsed.vendor === 'string' ? parsed.vendor : null,
      };

      // [DOCCHECK] The sharper question, on the same text. Grounding proves a figure is PRINTED;
      // this asks whether it is printed WHERE A TOTAL IS PRINTED — which is what tells a real total
      // apart from the subtotal, a line item and the BTW, all three of which are printed too. It
      // also gives the invoice DATE and NUMBER a witness for the first time.
      //
      // Stored beside the grounding rather than replacing it: the two answer different questions,
      // and a screen that wants to say "we found this literally in the text" still needs the first.
      const check = verifyDocument(
        {
          totalIncBtw: parsed.total_inc_btw,
          btwAmount: parsed.btw_amount,
          invoiceDate: parsed.invoice_date,
          invoiceNumber: parsed.invoice_number,
        },
        // Never the OCR transcription. That reply is a bare LIST OF AMOUNTS with no labels and no
        // guarantee of completeness, so 'anchored' can never fire on it and 'largest' would be a
        // claim about a page we only partly saw — it would flag correct totals as 'present' and
        // hold them. Passing null makes every field say the check did not run, which is true.
        grounding.source === 'ocr' ? null : statementText,
      );
      (parsed.field_confidence as unknown as Record<string, unknown>)._doccheck = check;
    }

    // [BRIDGE-EXTRACT] Defensive guard: if the AI returned OUR name as the vendor
    // despite the prompt, drop it — the receiver is never the vendor. Loose match
    // (case-insensitive, trimmed) so "kiwi food market" ~ "Kiwi Food Market B.V."
    if (receiverName && parsed.vendor) {
      const norm = (s: string) => s.toLowerCase().replace(/\b(b\.?v\.?|v\.?o\.?f\.?|n\.?v\.?)\b/g, '').replace(/[^a-z0-9]/g, '').trim();
      const v = norm(parsed.vendor);
      const r = norm(receiverName);
      if (v && r && (v === r || v.includes(r) || r.includes(v))) {
        parsed.vendor = undefined;          // never surface the receiver as vendor
        parsed.field_confidence.vendor = 0; // force-flag: the user must supply it
      }
    }

    // [BRIDGE-EXTRACT] Defensive guard: strip page-number patterns mistaken for
    // an invoice number. "1-1", "1 van 2", "Pagina 1/3" are pages, not invoices.
    if (parsed.invoice_number) {
      const inv = parsed.invoice_number.trim();
      const looksLikePage =
        /^\d{1,2}\s*[-/]\s*\d{1,2}$/.test(inv) ||                 // 1-1, 1/2
        /^(pagina|page|blad|pag\.?)\b/i.test(inv) ||              // Pagina 1...
        /\bvan\b/i.test(inv);                                     // 1 van 2
      if (looksLikePage) {
        parsed.invoice_number = undefined;
        parsed.field_confidence.invoice_number = 0; // force-flag for confirmation
      }
    }

    // [PAY-SAFE-EXTRACT] Normalize the vendor payment fields.
    // IBAN: strip ALL whitespace, uppercase (canonical form for storage +
    // future mod-97 validation at QR-prepare time). Empty → undefined.
    // We do NOT validate the IBAN here (prepare-time concern) — we only
    // canonicalize so storage is consistent. An obviously-too-short value is
    // dropped to avoid persisting junk (a real IBAN is ≥15 chars).
    if (typeof parsed.vendor_iban === 'string') {
      const iban = parsed.vendor_iban.replace(/\s+/g, '').toUpperCase();
      const usable = iban.length >= 15 && /^[A-Z0-9]+$/.test(iban);
      // [REKENING-GELEZEN] Same lesson as the btw number one block down: the drop is right, and
      // it destroyed the only evidence that this invoice printed an account number at all. The
      // checklist then told the owner "er staat geen rekeningnummer op deze factuur" about a page
      // that plainly carries one — which is not a gap in our looking, it is a false statement
      // about their paper, on the axis where being wrong costs them the payment.
      if (iban && !usable) {
        (parsed.field_confidence as unknown as Record<string, unknown>)._vendor_iban_printed = iban;
      }
      parsed.vendor_iban = usable ? iban : undefined;
    } else {
      parsed.vendor_iban = undefined;
    }
    // [SUPPLIER-IDENTITY] KVK: digits only, exactly 8 (a real Dutch KVK) — else drop as junk.
    if (typeof parsed.vendor_kvk === 'string') {
      const kvk = parsed.vendor_kvk.replace(/\D/g, '');
      parsed.vendor_kvk = kvk.length === 8 ? kvk : undefined;
    } else {
      parsed.vendor_kvk = undefined;
    }
    // [SUPPLIER-IDENTITY] BTW: strip spaces, uppercase; keep only a well-formed NL BTW id
    // (NL + 9 digits + B + 2 digits). A foreign/short/garbled value → undefined (not a key).
    if (typeof parsed.vendor_btw === 'string') {
      const btw = parsed.vendor_btw.replace(/\s+/g, '').toUpperCase();
      // [BTW-NUMMER-GELEZEN] Keep what was PRINTED before the identity filter throws it away.
      //
      // The drop below is right on its own terms — a garbled or foreign value must never become a
      // supplier KEY. But it also destroys the only evidence that this invoice printed a btw
      // number at all, and art. 35a Wet OB requires one on a real factuur: without it the
      // voorbelasting on this cost is refusable. So the malformed case, which is exactly the case
      // worth telling the owner about, was the one case that vanished silently.
      //
      // Stored, judged later (vendor-identity.ts). Nothing downstream reads this as a key.
      if (btw) {
        (parsed.field_confidence as unknown as Record<string, unknown>)._vendor_btw_printed = btw;
      }
      parsed.vendor_btw = /^NL\d{9}B\d{2}$/.test(btw) ? btw : undefined;
    } else {
      parsed.vendor_btw = undefined;
    }

    // [RECEIVER-IDENTITY] Programmatic backstop: never let OUR own identity leak through as the
    // vendor's. If the model — despite the prompt — returned the receiver's (our) KVK/BTW/IBAN as
    // the vendor's, drop it. Both sides are already canonicalized identically, so this is an exact
    // match. This is the code-level guarantee behind the prompt rules, and it also fixes the case
    // where the vendor NAME was suppressed but its identity numbers survived (self-supplier
    // pollution: a supplier row keyed on our own company).
    // ── [EIGEN-FACTUUR] Decided HERE, one line BEFORE the evidence is destroyed ──
    //
    // The three drops below are correct on their own terms — our identity must never be recorded
    // as a supplier. But they also erase the only proof that this document is our OWN sales
    // invoice, and the guard that asks that question used to sit in the CALLER, after this
    // function returned. Measured on the reported case (Kiwi Food Market, €394,99):
    //
    //   as the document reads              → certain, 4 matching identifiers → blocked
    //   after these three lines            → likely, name only               → blocked, softer
    //   …and the model also obeyed the prompt rule "never name the receiver as the vendor"
    //                                      → nothing matched                 → BOOKED AS A COST
    //
    // So the guard failed exactly when the reader worked best, and the failure was invisible: the
    // €362,38 of turnover stands again as a cost and the €32,61 of BTW OWED is claimed back as
    // voorbelasting — a €65 swing on one document, in the direction the Belastingdienst charges
    // interest on, with every number real and every total adding up.
    //
    // Placing it inside the reader fixes a second thing at the same time. FIVE doors call this
    // function — the mail sync, the manual upload, /api/intake, attaching a file to a bank line,
    // and "opnieuw inlezen" on a stored document — and only the mail sync carried the guard. A
    // check that lives at one door is a check the other four do not have.
    const eigenStuk = looksLikeOwnDocument(
      {
        vendorName: parsed.vendor ?? null,
        kvkNumber: parsed.vendor_kvk ?? null,
        btwNumber: parsed.vendor_btw ?? null,
        vendorIban: parsed.vendor_iban ?? null,
      },
      {
        companyName: receiverName ?? null,
        kvkNumber: opts?.receiverKvk ?? null,
        btwNumber: opts?.receiverBtw ?? null,
        iban: opts?.receiverIban ?? null,
      },
    );
    if (eigenStuk.isOwn) {
      // Answered as "not an invoice" WITH a reason, deliberately: that is the path the skip
      // registry already surfaces, so the file is kept and NAMED on the owner's screen instead of
      // vanishing. Nothing is booked, and nothing is lost.
      return {
        is_invoice: false,
        confidence: 0,
        reason: ownDocumentNotice(eigenStuk) ?? 'Dit lijkt je eigen verkoopfactuur.',
      };
    }

    // ── [ZELFFACTUUR] The word on the paper, which no reading can contradict ──
    //
    // A self-billed invoice is drawn up by the BUYER on the seller's behalf. When the owner is the
    // seller, that document is their own turnover arriving in the incoming pile, and booking it as
    // a cost is the [EIGEN-FACTUUR] damage exactly: the sale stands again as an expense and the
    // btw OWED is claimed back as voorbelasting.
    //
    // The identity guard directly above catches that whenever the paper carries the owner's KVK,
    // btw number or IBAN — which it legally must. The number guard directly below cannot: a
    // self-billed invoice carries the CUSTOMER's number series, from a run this app has never
    // issued. So on this one document class the second line of defence is structurally absent, and
    // an owner with a half-filled profile has nothing left. The printed word is a third handle,
    // and it depends on neither the model naming the parties right nor the profile being complete.
    //
    // It decides NOTHING. We do not know which side the owner is on, and we must not guess: this
    // is recorded, the document waits for one look, and the owner says. That look repeats per
    // document, which is the cost — the right trade at zero instances, and if it ever becomes
    // routine with one counterparty the answer is a per-supplier acknowledgement, never a weaker
    // check.
    if (selfBilledWordInDocument(statementText)) {
      parsed.field_confidence = { ...(parsed.field_confidence ?? {}), _zelffactuur: true };
    }

    // ── [EIGEN-NUMMER] Recognised by the number the app itself issued ──
    //
    // The identity guard above needs the reader to have named the OWNER as the vendor — and the
    // measured miss (Kiwi, €394,99) is the case where it named the CUSTOMER instead, so nothing
    // matched. But the app wrote that document: it knows the number, the client and the total it
    // printed. If the extracted number is one of the owner's own outgoing invoices AND the stored
    // row corroborates (same total, or the "vendor" is that row's client — the role-confusion
    // signature exactly), this is our own work coming back, whatever the reader thought the roles
    // were. A lookup failure answers null and the reading continues: this layer may only ADD
    // recognition, never take a real supplier invoice down with a database hiccup.
    if (!eigenStuk.isOwn && parsed.invoice_number && opts?.lookupOwnInvoice) {
      // [EIGEN-CONTROLE-ONBEKEND] A lookup that FAILED and a lookup that found nothing are not the
      // same answer, and this is one of the few checks where the difference costs real money: the
      // silent outcome of a database hiccup here is the owner's own turnover booked as a cost,
      // with the BTW they OWE claimed as voorbelasting. The catch below used to make those two
      // outcomes identical.
      //
      // The layer still may not REFUSE on a hiccup — that would take a real supplier invoice down
      // with the database. So the failure is carried instead, exactly the way [IBAN-CHECK-HONEST]
      // and [ONE-INVOICE-UNVERIFIED] carry theirs: the row lands in the human queue with a
      // sentence that says the check could not run, and never claims it ran clean.
      let ownRow: Awaited<ReturnType<NonNullable<typeof opts.lookupOwnInvoice>>> | null = null;
      let ownLookupFailed = false;
      try {
        ownRow = await opts.lookupOwnInvoice(parsed.invoice_number);
      } catch (e) {
        ownLookupFailed = true;
        console.error('[EIGEN-CONTROLE-ONBEKEND] own-invoice lookup failed — the read continues, flagged', e);
      }
      if (ownLookupFailed) {
        parsed.field_confidence = {
          ...(parsed.field_confidence ?? {}),
          _own_check_unavailable: true,
        };
      }
      if (ownRow) {
        const byNumber = matchesOwnInvoiceNumber(
          {
            invoiceNumber: parsed.invoice_number,
            totalIncBtw: parsed.total_inc_btw ?? parsed.amount ?? null,
            vendorName: parsed.vendor ?? null,
          },
          ownRow,
        );
        if (byNumber.isOwn) {
          return {
            is_invoice: false,
            confidence: 0,
            reason: ownDocumentNotice(byNumber) ?? 'Dit is je eigen verkoopfactuur.',
          };
        }
      }
    }

    if (myKvk && parsed.vendor_kvk === myKvk) parsed.vendor_kvk = undefined;
    if (myBtw && parsed.vendor_btw === myBtw) parsed.vendor_btw = undefined;
    if (myIban && parsed.vendor_iban === myIban) parsed.vendor_iban = undefined;

    // payment_reference: trim; empty → undefined (the system falls back to the
    // invoice number when preparing a payment, so a missing reference is fine).
    if (typeof parsed.payment_reference === 'string') {
      const ref = parsed.payment_reference.trim();
      parsed.payment_reference = ref.length ? ref : undefined;
    } else {
      parsed.payment_reference = undefined;
    }

    // [EXTRACT-DUE-DATE] Normalize the two raw due-date signals. We do NOT
    // compute the due date here — safecore.deriveDueDate() does that at the
    // write paths. Here we only sanitize: keep due_date as a trimmed string
    // (deriveDueDate tolerates ISO or DD-MM-YYYY), and keep payment_term_days
    // only when it is a sane positive integer-ish day count. Junk → undefined.
    if (typeof parsed.due_date === 'string') {
      const dd = parsed.due_date.trim();
      parsed.due_date = dd.length ? dd : undefined;
    } else {
      parsed.due_date = undefined;
    }
    if (
      typeof parsed.payment_term_days === 'number' &&
      isFinite(parsed.payment_term_days) &&
      parsed.payment_term_days > 0 &&
      parsed.payment_term_days <= 365
    ) {
      parsed.payment_term_days = Math.round(parsed.payment_term_days);
    } else {
      parsed.payment_term_days = undefined;
    }

    // [SMART-INTAKE] Normalize the classification fields. Default to the safe
    // side: unknown kind → 'invoice' (enters the verify queue, human reviews);
    // unknown paid → false (human confirms payment, never auto-mark paid).
    parsed.document_kind =
      parsed.document_kind === "receipt" || parsed.document_kind === "other"
        ? parsed.document_kind
        : "invoice";
    parsed.is_paid = parsed.is_paid === true;
    // [PEN-MARK] Normalize the pen/stamp payment hints. Only keep them when the doc is actually
    // marked paid — a method/date without is_paid is noise. paid_method must be one of the three
    // known values; paid_date is tolerated in either ISO or DD-MM-YYYY and normalized (null-safe).
    if (parsed.is_paid) {
      parsed.paid_method =
        parsed.paid_method === "bank" || parsed.paid_method === "kas" || parsed.paid_method === "pin"
          ? parsed.paid_method
          : null;
      parsed.paid_date =
        typeof parsed.paid_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(parsed.paid_date)
          ? parsed.paid_date.slice(0, 10)
          : null;
    } else {
      parsed.paid_method = null;
      parsed.paid_date = null;
    }
    // [BRIDGE-CREDITNOTA-SIGN] Strict boolean; unknown → false (safe side:
    // a normal invoice with a stray negative stays blocked by num() below +
    // the SAFECORE gate — never silently treated as a creditnota).
    parsed.is_credit_note = parsed.is_credit_note === true;
    // [REMINDER] Strict boolean, OR-ed with a deterministic filename backstop so a reminder
    // the model booked as a plain invoice is still flagged. Not a rejection — a reminder is a
    // real (single) invoice; the flag only routes it to the human to check it isn't a duplicate.
    parsed.is_reminder = parsed.is_reminder === true || isReminderFilename(filename);
    // [AANSLAG] Closed list, else null. The name rule in tax-letter.ts is the backstop for a
    // Belastingdienst letter the model left unnamed.
    // …and only for the tax office itself. An accountant's invoice for "verzorgen aangifte
    // inkomstenbelasting" is a cost with reclaimable btw; the model, asked to name the tax a
    // document concerns, named it — and a stored kind is honoured everywhere, so that invoice
    // silently left the costs. The sender decides whether a kind can exist at all.
    parsed.tax_kind = isTaxKind(parsed.tax_kind) && isTaxOfficeName(typeof parsed.vendor === 'string' ? parsed.vendor : null) ? parsed.tax_kind : null;

    // [TRUST-UNCERTAIN] Confidence banding — never silently drop a real-but-hard
    // invoice. Below the hard floor (or with no invoice signal at all) it's spam /
    // a newsletter → skip. In the uncertain band [0.35, 0.6) WITH a vendor or an
    // amount, we route it to the human verify queue FLAGGED instead of discarding
    // it: is_invoice becomes true, `uncertain` is set, and we cap the amount
    // confidence so the health surface shows "onzeker gelezen — controleer". The
    // human then confirms or dismisses; the invoice is never lost without a trace.
    const hasInvoiceSignal =
      !!parsed.vendor ||
      parsed.total_inc_btw != null ||
      parsed.total_ex_btw != null ||
      parsed.amount != null;
    const band = decideConfidenceBand(parsed.confidence, hasInvoiceSignal);
    if (band === 'skip') {
      return {
        is_invoice: false,
        confidence: parsed.confidence,
        reason: parsed.reason || 'Te lage zekerheid — bestand overgeslagen',
      };
    }
    if (band === 'review') {
      parsed.is_invoice = true;
      parsed.uncertain = true;
      parsed.field_confidence = {
        ...(parsed.field_confidence ?? {}),
        amount: Math.min(parsed.field_confidence?.amount ?? 0.4, 0.4),
      };
    }

    // [TRUST-CONFIDENT-FALSE] A CONFIDENT "not an invoice" (accept band, so it skipped the
    // 'review' rescue above) that still carries a strong invoice signal (vendor + amount) and
    // is not a statement filename is most likely a mis-judged real invoice — a verzamelfactuur
    // read as a statement. Rescue it to the verify queue flagged 'uncertain' instead of letting
    // the caller discard it unseen. Held as 'processing' downstream ⇒ never booked as a cost
    // until the human confirms. (The low-confidence 'skip' band already returned above.)
    if (parsed.is_invoice === false && shouldRescueNonInvoice(parsed, filename)) {
      parsed.is_invoice = true;
      parsed.uncertain = true;
      parsed.field_confidence = {
        ...(parsed.field_confidence ?? {}),
        amount: Math.min(parsed.field_confidence?.amount ?? 0.4, 0.4),
      };
    }

    // [BOEK-011] Normalize and reconcile amounts — never let bad numbers reach DB
    const num = (v: unknown): number | undefined =>
      typeof v === 'number' && isFinite(v) && v >= 0 ? v : undefined;
    // [BRIDGE-CREDITNOTA-SIGN] On a creditnota the amounts are legitimately
    // NEGATIVE (matching the paper + the outgoing creditnota route [BOEK-031],
    // which stores -(original.x)). numSigned accepts any finite number; it is
    // used ONLY when is_credit_note=true. Normal invoices keep num() exactly
    // as before — a stray negative there is an extraction error and stays
    // filtered (conditional, never permissive).
    const numSigned = (v: unknown): number | undefined =>
      typeof v === 'number' && isFinite(v) ? v : undefined;
    // [CREDIT-BACKSTOP] Without this, num() below rejects a negative amount as a "stray
    // negative" and drops it to undefined — turning a real -1.123,14 credit into an empty €0
    // record flagged "totaalbedrag ontbreekt". A negative printed total means credit, so flip
    // it before choosing the number normaliser (see shouldTreatAsCreditNote).
    parsed.is_credit_note = shouldTreatAsCreditNote(
      parsed.is_credit_note,
      parsed.total_inc_btw,
      parsed.total_ex_btw,
    );
    const pickNum = parsed.is_credit_note === true ? numSigned : num;

    parsed.total_ex_btw = pickNum(parsed.total_ex_btw);
    parsed.btw_amount = pickNum(parsed.btw_amount);
    parsed.total_inc_btw = pickNum(parsed.total_inc_btw);
    // [BOEK-011 double-check m.5] btw_rate must be a real Dutch VAT rate.
    // num() alone would accept e.g. 6 (old rate) or 121 (amount mistaken for a
    // rate). Constrain to the three valid values; anything else → undefined so
    // it's treated as "unknown" rather than persisting a bogus rate.
    {
      const r = num(parsed.btw_rate);
      parsed.btw_rate = r !== undefined && [0, 9, 21].includes(r) ? r : undefined;
    }

    // A derived money value is rounded to the cent — an unrounded ex+btw (e.g. 42.99999999999999)
    // is stored verbatim into a numeric column and then never matches a clean re-read of 43.00 on
    // an exact-equality dedup query, silently defeating duplicate detection (a double-book).
    // [CENT] round2 uit invoice-totals — zie de kop daar; deze functie had een eigen versie die
    // een negatief half cent naar nul rondde en een gedreven half cent liet vallen.
    // [PRINTED-TOTAL] Reconcile: if total is missing but ex + btw exist → compute it.
    //
    // And RECORD that we did. Filling the third amount is the right call — an invoice with two of
    // three is more useful than one with two of three and a gap — but it makes "excl + btw =
    // totaal" hold by construction, and from that moment the arithmetic gate is testing our own
    // subtraction rather than the invoice. Without this mark the checklist would report that as a
    // check the app performed and passed. See _total_derived in import-health.ts.
    const markDerived = (which: 'total' | 'excl') => {
      parsed.field_confidence = { ...(parsed.field_confidence ?? {}), _total_derived: which };
    };
    if (parsed.total_inc_btw === undefined &&
        parsed.total_ex_btw !== undefined &&
        parsed.btw_amount !== undefined) {
      parsed.total_inc_btw = round2(parsed.total_ex_btw + parsed.btw_amount);
      markDerived('total');
    }
    // Reconcile: if ex is missing but total + btw exist → compute it
    if (parsed.total_ex_btw === undefined &&
        parsed.total_inc_btw !== undefined &&
        parsed.btw_amount !== undefined) {
      parsed.total_ex_btw = round2(parsed.total_inc_btw - parsed.btw_amount);
      markDerived('excl');
    }
    // [EX-INCL-FIX] Recover a base that a mislabelled "Subtotaal" set equal to the incl total
    // while a real BTW is printed (impossible). Trusts incl + btw → ex = incl − btw.
    {
      const exBefore = parsed.total_ex_btw;
      parsed.total_ex_btw = fixExInclConfusion(
        parsed.total_ex_btw, parsed.btw_amount, parsed.total_inc_btw,
      );
      // [EX-INCL-FIX zichtbaar] Every sibling repair leaves a trace (_btw_derived,
      // _assurantiebelasting, _total_derived) precisely so a human confirms our arithmetic before
      // it books — this one rewrote the base, made the identity hold by construction, and left
      // nothing. The number that becomes kosten was our subtraction; say so, and let
      // classifyImportHealth hold the row like its siblings.
      if (exBefore !== undefined && parsed.total_ex_btw !== undefined && exBefore !== parsed.total_ex_btw) {
        parsed.field_confidence = {
          ...(parsed.field_confidence ?? {}),
          _ex_corrected: { read: exBefore, used: parsed.total_ex_btw },
        };
      }
    }

    // [BTW-SUM-FIX] Recover a BTW total mis-summed from a MIXED-RATE summary block, using the two
    // figures the reader did NOT have to compute (printed excl + printed paid total). Runs AFTER
    // fixExInclConfusion by design: that one repairs the base from incl + BTW and only fires when
    // ex ≈ incl, which leaves the identity exact — so the two can never fight over the same row.
    {
      const fixed = fixMisSummedBtw(parsed.total_ex_btw, parsed.btw_amount, parsed.total_inc_btw);
      if (fixed.derived) {
        // Mark it: the amounts now add up, so no other signal would flag this invoice — but the
        // BTW is our arithmetic, not the invoice's, and it is deductible money. The owner confirms.
        parsed.field_confidence = {
          ...(parsed.field_confidence ?? {}),
          _btw_derived: { read: parsed.btw_amount ?? null, used: fixed.btw ?? null },
        };
        parsed.btw_amount = fixed.btw;
        // A blend has no single rate. Drop a stated btw_rate that no longer matches what the
        // repaired BTW actually implies, rather than persisting a rate the amounts contradict.
        const ex = parsed.total_ex_btw ?? 0;
        const impliedRate = Math.abs(ex) > 0.005
          ? Math.round(Math.abs((fixed.btw ?? 0) / ex) * 100)
          : undefined;
        if (parsed.btw_rate !== undefined && parsed.btw_rate !== impliedRate) {
          parsed.btw_rate = undefined;
        }
      }
    }

    // [ASSURANTIE] Insurance premium tax is not deductible BTW. The reader was told to zero it,
    // but the guard enforces it regardless of what came back — a euro of IPT booked as
    // voorbelasting is a refund the Belastingdienst disallows. It uses the model's own flag as the
    // detector (the model read the file; the raw text is not here), and folds the tax back into
    // the cost. `corrected` marks field_confidence so classifyImportHealth holds it for a human;
    // it never auto-books, exactly like a derived BTW.
    {
      const signal = parsed.has_assurantiebelasting === true ? "assurantiebelasting" : null;
      const g = stripAssurantiebelastingBtw(signal, parsed.total_ex_btw, parsed.btw_amount, parsed.total_inc_btw);
      if (g.corrected) {
        parsed.field_confidence = {
          ...(parsed.field_confidence ?? {}),
          _assurantiebelasting: { read: parsed.btw_amount ?? null },
        };
        parsed.total_ex_btw = g.ex;
        parsed.btw_amount = g.btw;
        // The premium tax is not a BTW rate, so a stated rate no longer describes this document.
        parsed.btw_rate = undefined;
      }
    }

    // [VERLEGD-NAAR-MIJ] De leverancier heeft de BTW naar deze eigenaar verlegd. Alleen VASTLEGGEN,
    // niets herrekenen: de factuur is precies goed zoals ze is (geen BTW, geen tarief), en wat er
    // moet gebeuren gebeurt één laag verder — rubriek 2a op de aangifte, met dezelfde euro's weer
    // terug in 5b. Het TARIEF staat niet op zo'n document, dus dat wordt hier niet bedacht.
    if (parsed.has_btw_verlegd === true) {
      parsed.field_confidence = {
        ...(parsed.field_confidence ?? {}),
        _btw_verlegd: { grondslag: parsed.total_ex_btw ?? parsed.total_inc_btw ?? null },
      };
    }

    // [VREEMDE-VALUTA] The document named a currency, and it is not the euro. Record it and stop
    // there: the amounts stay exactly as printed, because converting them needs the rate on the
    // invoice date and this app has none. The key is the whole mechanism — it holds the invoice
    // out of the auto-booking path and it names the currency where the owner reads it. Absent, or
    // the euro, writes nothing at all, which is how 100 % of the documents seen so far behave.
    {
      const valuta = foreignCurrencyHold(parsed.currency);
      if (valuta.hold && valuta.code != null) {
        parsed.field_confidence = {
          ...(parsed.field_confidence ?? {}),
          _valuta: { code: valuta.code },
        };
      }
    }

    // [BTW-SPLIT] Carry the per-rate summary block through to storage.
    //
    // It is stored and never acted on here, and that is the whole design. Repairing Enka Horeca
    // from this block means writing a new btw AND a new total — changing what the owner pays, on
    // the strength of a read we have just established was wrong about this very invoice. The block
    // goes to the checklist instead, which can say "the specification on your invoice adds up to
    // € 122,64 and we read € 122,18" and let the person holding the paper decide.
    //
    // Not on a CREDITNOTA, and that exclusion is deliberate. There the sign of a per-rate row is
    // genuinely ambiguous: the paper may print the specification positive with the credit-ness
    // carried by the document type, and a NET-CREDIT invoice legitimately mixes signs (positive
    // goods BTW over a negative net excl — the Altena case in safecore.ts). Comparing such a block
    // against our signed totals would flag correctly-read credit notes, which already always need
    // a human anyway (auto-advance refuses them outright). Noise there buys nothing and costs the
    // credibility of the warning everywhere else.
    {
      const rows = parsed.is_credit_note === true || !Array.isArray(parsed.btw_breakdown)
        ? []
        : parsed.btw_breakdown;
      const clean = rows
        .filter((r): r is { rate: number; base: number; btw: number } => {
          if (!r || typeof r !== 'object') return false;
          const rate = (r as { rate?: unknown }).rate;
          // Only a legal Dutch rate. A row labelled 6% or 100% is a mis-read of the layout, and
          // one bad row poisons the column sums this block exists to provide.
          if (typeof rate !== 'number' || ![0, 9, 21].includes(rate)) return false;
          return (
            typeof (r as { base?: unknown }).base === 'number' && isFinite((r as { base: number }).base) &&
            typeof (r as { btw?: unknown }).btw === 'number' && isFinite((r as { btw: number }).btw)
          );
        })
        .map((r) => ({ rate: r.rate, base: round2(r.base), btw: round2(r.btw) }))
        // A Dutch invoice has at most three rates. More than that is not a specification block,
        // and an unbounded array from a model reply has no business reaching a jsonb column.
        .slice(0, 6);
      if (clean.length > 0) {
        parsed.field_confidence = { ...(parsed.field_confidence ?? {}), _btw_rows: clean };
      }

      // [REGELS] No printed block? Then the LINES are the only witness left, and on a mixed-rate
      // document they are the constraint btw-split.ts describes as evaporating. Group them per
      // rate, apply the rate, and require the result to reproduce BOTH printed anchors — the excl
      // total and the btw. splitFromLines refuses on any mismatch rather than repairing anything,
      // so what lands here has been CHECKED against the paper, never fitted to it.
      //
      // Kept under its own key. `_btw_rows` means the supplier printed a specification; this means
      // we built one from the goods. The two are different evidence and the screens say so.
      // Excluded on a creditnota for exactly the reason the block above is.
      if (clean.length === 0 && parsed.is_credit_note !== true) {
        const fromLines = splitFromLines({
          lines: (parsed.invoice_lines ?? []).map((l) => ({
            description: l?.description ?? null,
            quantity: l?.quantity ?? null,
            unitPrice: l?.unit_price ?? null,
            btwRate: l?.btw_rate ?? null,
            amount: l?.amount ?? null,
          })),
          totalExBtw: parsed.total_ex_btw,
          btwAmount: parsed.btw_amount,
        });
        if (fromLines.ok) {
          parsed.field_confidence = {
            ...(parsed.field_confidence ?? {}),
            _btw_rows_uit_regels: fromLines.rows.slice(0, 6),
          };
        }
      }
    }

    // [PRINTED-TOTAL] Keep the printed final total next to the one we ended up with.
    //
    // Only when the two DISAGREE, because that is the only case it says anything: the reader read
    // "Totaal te voldoen" and then returned a different total_inc_btw, so one of its own numbers
    // is wrong and it could not tell which. Storing it always would just be a second copy of a
    // figure we already hold. Nothing is overwritten — picking the printed one would be guessing
    // in a place where the disagreement is exactly what the owner needs to see.
    {
      const printed = typeof parsed.total_printed === 'number' && isFinite(parsed.total_printed)
        ? round2(parsed.total_printed)
        : null;
      //
      // Compared on MAGNITUDE. A creditnota's paper usually prints its total without a minus and
      // carries the credit-ness in the document type, so a sign difference here is a formatting
      // artefact and would hold every credit note. Whether the sign is right is a question the
      // creditnota gate already owns (shouldTreatAsCreditNote + evaluateCreditnotaArithmetic);
      // this field answers a different one — did the reader read a different NUMBER than it
      // reported — and every real digit difference still shows up.
      if (printed !== null && parsed.total_inc_btw !== undefined &&
          Math.abs(Math.abs(printed) - Math.abs(parsed.total_inc_btw)) > 0.02) {
        parsed.field_confidence = { ...(parsed.field_confidence ?? {}), _total_printed: printed };
      }
    }

    // [BTW-GATE aan de bron] auto-advance refuses a materially-priced invoice whose read btw is 0
    // without an explicit 0% rate — a 21% invoice misread as ex==incl books with its voorbelasting
    // silently zeroed. But that refusal lived ONLY in the machine's own gate: the verify queue
    // computed health from the stored row (which keeps no rate), called the same invoice "klaar",
    // and offered it to the bulk-confirm tap. The machine politely declined what the screen was
    // inviting the human to do in one tap. Mirror the rule at the source, in the channel health
    // already reads: a low amount confidence (< 0.7) holds the row for review on every list.
    // A genuine 0%/vrijgesteld read (btw_rate === 0) stays clean, exactly as in auto-advance.
    {
      const gross = parsed.total_inc_btw ?? parsed.amount;
      const materially = typeof gross === 'number' && Math.abs(gross) >= 0.005;
      const zeroBtw = typeof parsed.btw_amount === 'number' && Math.abs(parsed.btw_amount) < 0.005;
      if (parsed.is_invoice === true && materially && zeroBtw && parsed.btw_rate !== 0) {
        parsed.field_confidence = {
          ...(parsed.field_confidence ?? {}),
          amount: Math.min(parsed.field_confidence?.amount ?? 1, 0.4),
        };
      }
    }

    // amount = total incl. BTW (kept for backward compatibility)
    parsed.amount = parsed.total_inc_btw ?? parsed.amount;

    return parsed;
  } catch (error) {
    console.error('[BOEK-011] verifyInvoiceFromPdf failed:', error);
    // [TRANSIENT-RETRY] An INFRA/read failure is NOT a verdict that the file is unreadable — a
    // genuine "not an invoice" is a normal parsed return, never an exception. So when the caller
    // opted in (email-sync / reimport), re-throw ANY Claude HTTP API error (429/5xx transient, but
    // also a 404 model-unavailable / 400 / 403 config error) and network failure. The email-sync
    // then retries next sync (never a permanent 'could_not_read' skip); the manual re-read 502s
    // honestly ("probeer later opnieuw") instead of the swallowed FALLBACK being reported as
    // "geen boekbare factuur — negeer" (a config error must never masquerade as a document verdict).
    // [COST-GUARD] And the spend fuse belongs in exactly the same category, which it was not in.
    // It refuses BEFORE the call, so it produces no "API error" text and no network symptom —
    // isTransientAiError and isAiApiError both answer false, and a blown daily ceiling came back
    // as a confident verdict that the document is not an invoice. Measured, not reasoned: see the
    // gate in ai-budget.test.ts. Downstream that verdict is permanent (the e-mail sync registers
    // could_not_read and lets the watermark pass), so one exhausted budget quietly retired every
    // real invoice that arrived while it was blown — during a backfill, which is when it blows.
    if (opts?.throwOnTransient && (isTransientAiError(error) || isAiApiError(error) || isAiBudgetError(error))) throw error;
    return FALLBACK;
  }
}

// ─────────────────────────────────────────────────────────
// 3. Translate factuurregels to professional Dutch
// [BOEK-018] translateToNL — May 2026
// ─────────────────────────────────────────────────────────
export async function translateToNL(
  text: string,
  sourceLanguage: string
): Promise<TranslateResult> {
  const FALLBACK: TranslateResult = { translation: text, original: text };

  try {
    const systemPrompt = `${SYSTEM_BASE}

You translate invoice line descriptions to professional Dutch.
Return only a JSON object:
{
  "translation": "professional Dutch translation",
  "original": "original text as given"
}`;

    const prompt = `Translate this invoice description to professional Dutch.
Source language: ${sourceLanguage}
Text: ${text}

Return JSON only.`;

    const result = await callClaude(prompt, systemPrompt);
    const parsed = safeParseJSON<TranslateResult>(result);
    if (!parsed) return FALLBACK;

    parsed.original = text;
    return parsed;
  } catch (error) {
    console.error('[BOEK-018] translateToNL failed:', error);
    return FALLBACK;
  }
}

// ─────────────────────────────────────────────────────────
// 4. Compose Draft Queue email in Dutch
// [BOEK-018] composeDraftEmail — May 2026
// ─────────────────────────────────────────────────────────
export async function composeDraftEmail(
  accountantName: string,
  clientName: string,
  items: string[]
): Promise<ComposeDraftEmailResult> {
  const FALLBACK: ComposeDraftEmailResult = {
    subject: `Ontbrekende stukken — ${clientName}`,
    body: `Beste ${clientName},\n\nKun je de volgende stukken aanleveren?\n\n${items.map((i) => `- ${i}`).join('\n')}\n\nMet vriendelijke groet,\n${accountantName}`,
  };

  try {
    const systemPrompt = `${SYSTEM_BASE}

You compose professional Dutch emails from accountants to their clients.
Return only a JSON object:
{
  "subject": "email subject line",
  "body": "full email body with greeting and sign-off"
}`;

    const prompt = `Compose a professional Dutch email from an accountant to a client requesting missing documents.

Accountant name: ${accountantName}
Client name: ${clientName}
Missing items:
${items.map((item, i) => `${i + 1}. ${item}`).join('\n')}

Return JSON only.`;

    const result = await callClaude(prompt, systemPrompt);
    const parsed = safeParseJSON<ComposeDraftEmailResult>(result);
    if (!parsed) return FALLBACK;

    return parsed;
  } catch (error) {
    console.error('[BOEK-018] composeDraftEmail failed:', error);
    return FALLBACK;
  }
}

// ─────────────────────────────────────────────────────────
// 5. Match bank transaction to invoice
// [BOEK-018] matchTransaction — May 2026
// ─────────────────────────────────────────────────────────
export async function matchTransaction(
  transaction: TransactionInput,
  invoices: InvoiceInput[]
): Promise<MatchTransactionResult> {
  const FALLBACK: MatchTransactionResult = {
    matched: false,
    confidence: 0,
    reason: 'AI unavailable',
  };

  if (!invoices.length) {
    return { matched: false, confidence: 0, reason: 'No invoices to match against' };
  }

  try {
    const systemPrompt = `${SYSTEM_BASE}

You match bank transactions to invoices. Return only a JSON object:
{
  "matched": boolean,
  "invoice_id": "uuid string or null",
  "confidence": number between 0 and 1,
  "reason": "brief Dutch explanation"
}

Rules:
- confidence < 0.7 → set matched: false and invoice_id: null`;

    const prompt = `Match this bank transaction to one of the invoices below.

Transaction:
- Amount: €${transaction.amount}
- Date: ${transaction.date}
- Description: ${transaction.description}
- Counterpart: ${transaction.counterpart}

Invoices:
${invoices
  .map(
    (inv) =>
      `ID: ${inv.id} | Number: ${inv.invoice_number} | Amount: €${inv.total_inc_btw} | Client: ${inv.client_name} | Date: ${inv.invoice_date}`
  )
  .join('\n')}

Return JSON only.`;

    const result = await callClaude(prompt, systemPrompt);
    const parsed = safeParseJSON<MatchTransactionResult>(result);
    if (!parsed) return FALLBACK;

    parsed.confidence = Math.min(1, Math.max(0, parsed.confidence ?? 0));
    if (parsed.confidence < 0.7) {
      parsed.matched = false;
      parsed.invoice_id = undefined;
    }

    return parsed;
  } catch (error) {
    console.error('[BOEK-018] matchTransaction failed:', error);
    return FALLBACK;
  }
}

// ─────────────────────────────────────────────────────────
// 6. Classify expense from image/PDF description
// [BOEK-018] classifyExpense — May 2026
// ─────────────────────────────────────────────────────────
export async function classifyExpense(
  description: string,
  amount?: number
): Promise<ClassifyExpenseResult> {
  const FALLBACK: ClassifyExpenseResult = {
    category: 'other',
    btw_eligible: false,
    confidence: 0,
  };

  try {
    const systemPrompt = `${SYSTEM_BASE}

You classify business expenses for Dutch ZZP'ers.
Return only a JSON object:
{
  "category": "fuel" | "equipment" | "subscription" | "travel" | "office" | "other",
  "btw_eligible": boolean,
  "confidence": number between 0 and 1
}`;

    const prompt = `Classify this business expense.
Description: ${description}
${amount !== undefined ? `Amount: €${amount}` : ''}

Return JSON only.`;

    const result = await callClaude(prompt, systemPrompt);
    const parsed = safeParseJSON<ClassifyExpenseResult>(result);
    if (!parsed) return FALLBACK;

    parsed.confidence = Math.min(1, Math.max(0, parsed.confidence ?? 0));
    return parsed;
  } catch (error) {
    console.error('[BOEK-018] classifyExpense failed:', error);
    return FALLBACK;
  }
}

// ─────────────────────────────────────────────────────────
// 7. Generate invoice data from a natural language prompt
// [BOEK-018] generateInvoiceFromPrompt — May 2026
// Used by: BOEK-029 (ZZP dashboard — quick invoice creation)
//
// User types e.g.: "Factuur voor Ahmed, website gebouwd, €1200"
// AI returns structured invoice data ready to prefill the form
// Human reviews and confirms before anything is saved
// ─────────────────────────────────────────────────────────
export async function generateInvoiceFromPrompt(
  prompt: string
): Promise<GenerateInvoiceFromPromptResult> {
  const FALLBACK: GenerateInvoiceFromPromptResult = {
    client_name: '',
    lines: [],
  };

  try {
    const systemPrompt = `${SYSTEM_BASE}

You generate structured invoice data from a natural language description.
Return only a JSON object with these exact keys:
{
  "client_name": "name of the client (string, required)",
  "client_email": "email address of the client or null",
  "description": "short professional Dutch summary of the work (optional, single sentence)",
  "amount": number or null (total amount incl. BTW if clearly stated in the prompt),
  "btw_rate": 0 | 9 | 21 or null (top-level rate if all lines share the same rate),
  "lines": [
    {
      "description": "professional Dutch description of the work or product",
      "quantity": number,
      "unit_price": number (excluding BTW),
      "btw_rate": 0 | 9 | 21
    }
  ],
  "notes": "optional invoice notes in Dutch or null"
}

Rules:
- client_name is required — extract from the prompt or use empty string if not found
- lines must have at least one item if any work is described
- description (top-level): short Dutch summary, e.g. "Ontwikkeling website" — optional
- amount (top-level): only if the user mentioned a total price — numeric, incl. BTW
- btw_rate (top-level): set if all lines share the same rate, else null
- line description must always be professional Dutch — translate if needed
- quantity defaults to 1 if not mentioned
- unit_price must be excluding BTW (excl. BTW)
- line btw_rate defaults to 21 if not mentioned
- btw_rate 9 applies to: food, books, medicine, public transport, some services
- btw_rate 0 applies to: exports outside EU, certain exempt services
- notes: add only if the user mentioned special payment terms or remarks
- Never invent information not present in the prompt`;

    const userPrompt = `Generate invoice data from this description:

"${prompt}"

Extract: who is the client, what was delivered, at what price, and any special notes.
If a price is given including BTW, calculate the excl. BTW price based on the btw_rate.
Return JSON only.`;

    const result = await callClaude(userPrompt, systemPrompt);
    const parsed = safeParseJSON<GenerateInvoiceFromPromptResult>(result);
    if (!parsed) return FALLBACK;

    // [BOEK-018] sanitize all fields — May 2026

    // client_name must be a string
    if (typeof parsed.client_name !== 'string') {
      parsed.client_name = '';
    }

    // description: optional string
    if (parsed.description !== undefined && typeof parsed.description !== 'string') {
      parsed.description = undefined;
    }

    // amount: optional positive number
    if (parsed.amount !== undefined) {
      if (typeof parsed.amount !== 'number' || parsed.amount <= 0) {
        parsed.amount = undefined;
      }
    }

    // btw_rate (top-level): enforce 0 | 9 | 21 or undefined
    if (parsed.btw_rate !== undefined) {
      const validRates = [0, 9, 21] as const;
      if (!validRates.includes(parsed.btw_rate as 0 | 9 | 21)) {
        parsed.btw_rate = undefined;
      }
    }

    // lines: must be an array
    if (!Array.isArray(parsed.lines)) {
      parsed.lines = [];
    }

    parsed.lines = parsed.lines.map((line) => ({
      description: typeof line.description === 'string' ? line.description : '',
      // [MIN-REGEL] `quantity > 0 ? quantity : 1` rejected two different things with one test: a
      // quantity that cannot be read (right — one of the thing) and a NEGATIVE one, which is a
      // credit line and is exactly what an owner asking for "drie kratten retour" means. The same
      // guard in the free invoice tool turned -3 x EUR 23,95 into 1 x EUR 23,95. signInQuantity
      // also moves a minus out of the price, where an e-factuur may not carry it (BR-27).
      // A price this model did not give stays 0 — that is this caller's policy, not read-line's.
      ...signInQuantity(
        readQuantity(line.quantity),
        typeof line.unit_price === 'number' && Number.isFinite(line.unit_price) ? line.unit_price : 0,
      ),
      // Enforce btw_rate per line — default to 21
      btw_rate: ([0, 9, 21] as const).includes(line.btw_rate as 0 | 9 | 21)
        ? (line.btw_rate as 0 | 9 | 21)
        : 21,
    }));

    return parsed;
  } catch (error) {
    console.error('[BOEK-018] generateInvoiceFromPrompt failed:', error);
    return FALLBACK;
  }
}
// ─────────────────────────────────────────────────────────
// 8. Extract company registration details from invoice
// [BOEK-015] extractCompanyDetails — May 2026
//
// ⚠️ ZONDER AANROEPER sinds [TRUST-ONBOARDING]. Stap 3A ("upload een factuur, de AI vult je
// gegevens in") is verwijderd omdat hij op een ONTVANGEN factuur de KvK/BTW/IBAN van de
// LEVERANCIER als die van de eigenaar vastlegde — ongevalideerde juridische identiteit, die
// later op een factuur wordt afgedrukt. De route /api/onboarding/extract die deze functie
// aanriep is daarna blijven staan zonder scherm dat hem gebruikte, en is nu ook weg.
//
// Wie hem opnieuw wil inzetten: niet op de identiteit van de eigenaar. Daar is dit fout voor
// gebleken. Op INKOMENDE documenten verdient AI-extractie zijn geld wel.
//
// Was: BOEK-015 Onboarding — Step 3A (AI upload flow)
// Reads actual PDF or image content and extracts the SENDER's
// business registration data: bedrijfsnaam, KVK, BTW, IBAN
//
// Safe fallback: { found: false, all fields null }
// Never throws — onboarding continues even if AI fails
// ─────────────────────────────────────────────────────────
export async function extractCompanyDetails(
  fileBase64: string,
  mimeType: string,
  filename: string
): Promise<ExtractCompanyDetailsResult> {
  const FALLBACK: ExtractCompanyDetailsResult = {
    company_name: null,
    kvk_number: null,
    btw_number: null,
    iban: null,
    address: null,
    found: false,
  };

  // [BOEK-015] improved prompt — more examples, looser matching, explicit label variants
  const systemPrompt = `${SYSTEM_BASE}

You are extracting Dutch business registration data from an invoice or receipt.
Extract ONLY the SENDER's data — the company or person who issued/sent this document.
Do NOT extract the receiver/client data.

Return ONLY a JSON object with these exact keys (no markdown, no explanation):
{
  "company_name": string or null,
  "kvk_number": string or null,
  "btw_number": string or null,
  "iban": string or null,
  "address": string or null,
  "found": boolean
}

Extraction rules:
- company_name: the trading name or legal name of the sender. Look for it at the top of the document, in the header, or next to the logo.
- kvk_number: labeled as "KVK", "K.v.K.", "KvK-nummer", "Kvk", "Chamber of Commerce", "CoC". Extract digits only, ignore spaces and dots. Example: "KVK: 12 34 56 78" → "12345678"
- btw_number: labeled as "BTW", "BTW-nr", "BTW-nummer", "VAT", "VAT number", "Btw-id". Format: NL + digits + B + digits. Example: "BTW: NL 123456789 B01" → "NL123456789B01". Remove all spaces.
- iban: labeled as "IBAN", "Bankrekeningnummer", "Rekeningnummer". Keep full IBAN with country code, remove spaces.
- address: street name + house number of the sender only. Exclude city and postal code.
- found: set to true if at least company_name OR kvk_number was successfully extracted.
- If a field truly does not appear in the document, set it to null.`;

  const prompt = `Extract the SENDER's business registration details from this invoice document.
Filename: ${filename}

The sender is the company/person who created and sent this invoice (usually shown in the header or top section).

Search carefully for:
1. Company name / Bedrijfsnaam (top of document, near logo)
2. KVK number — may appear as: KVK, K.v.K., KvK-nummer, CoC (8 digits)
3. BTW number — may appear as: BTW, BTW-nr, BTW-nummer, VAT (format: NL123456789B01)
4. IBAN — may appear as: IBAN, Bankrekeningnummer, Rekeningnummer
5. Street address of the sender (not the client)

Return JSON only. If unsure between sender and receiver, choose the one at the TOP of the document.`;

  try {
    let raw: string;

    if (mimeType === 'application/pdf') {
      raw = await callClaudeWithPdf(fileBase64, prompt, systemPrompt);
    } else if (
      mimeType === 'image/jpeg' ||
      mimeType === 'image/png' ||
      mimeType === 'image/webp' ||
      mimeType === 'image/gif'
    ) {
      raw = await callClaudeWithImage(
        fileBase64,
        mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
        prompt,
        systemPrompt
      );
    } else {
      // Unsupported type — treat as text extraction best-effort
      raw = await callClaude(
        `Filename: ${filename}\n${prompt}`,
        systemPrompt
      );
    }

    const parsed = safeParseJSON<ExtractCompanyDetailsResult>(raw);
    if (!parsed) return FALLBACK;

    // [BOEK-015] Sanitize KVK — digits only, 7-8 digits accepted
    if (parsed.kvk_number) {
      const kvkClean = parsed.kvk_number.replace(/\D/g, '');
      // Accept 7 or 8 digits — some older KVK numbers are 7 digits
      parsed.kvk_number = (kvkClean.length >= 7 && kvkClean.length <= 8) ? kvkClean : null;
    }

    // [BOEK-015] Sanitize BTW — remove spaces/dots, normalize to NLxxxxxxxxxBxx
    if (parsed.btw_number) {
      const btwClean = parsed.btw_number.replace(/[\s.\-]/g, '').toUpperCase();
      // Accept standard Dutch BTW format
      parsed.btw_number = /^NL\d{9}B\d{2}$/.test(btwClean) ? btwClean : null;
    }

    // [BOEK-015] Sanitize IBAN — remove spaces, uppercase
    if (parsed.iban) {
      const ibanClean = parsed.iban.replace(/\s/g, '').toUpperCase();
      // Basic IBAN validation: 2 letters + digits, 10-34 chars
      parsed.iban = /^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(ibanClean) ? ibanClean : null;
    }

    // Recompute found after sanitization
    parsed.found = !!(parsed.company_name || parsed.kvk_number);

    return parsed;
  } catch (error) {
    console.error('[BOEK-015] extractCompanyDetails failed:', error);
    return FALLBACK;
  }
}
// [TRIANGLE] Transcribe a payment-terminal settlement receipt (Equens CTAP "TOTALEN
// RAPPORT") to VERBATIM plain text, so the proven pure parser (eft-parser.ts) — not the
// model — does the structured extraction and applies its reconciliation cross-checks. The
// model only reads the pixels; the arithmetic is deterministic and testable downstream.
export async function transcribeEftReceipt(
  fileBase64: string,
  mimeType: string,
  filename: string,
): Promise<string> {
  const systemPrompt =
    'Je transcribeert kassabon-achtige betaalterminal-afrekeningen exact zoals gedrukt. ' +
    'Verzin niets, corrigeer geen getallen, laat niets weg.';
  const prompt =
    'Dit is een afrekening/dagafsluiting van een betaalterminal (bijv. Equens CTAP, "TOTALEN RAPPORT"). ' +
    'Transcribeer ELKE regel exact zoals gedrukt — alle labels (TMS TERM-ID, PERIODE NR, PERIODE START/EINDE, ' +
    'DATUM EERSTE/LAATSTE TRX, EFT TOTALEN, BETALING, TOTAAL, en de kaartsoorten zoals V Pay, Maestro, ' +
    'Debit Mastercard, Visa Debit, MasterCard) met hun #TRX-aantallen en EUR-bedragen. ' +
    'Geef ALLEEN de tekst terug, geen uitleg.';

  const isPdf = mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf');
  if (isPdf) return callClaudeWithPdf(fileBase64, prompt, systemPrompt);

  const mt: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' =
    mimeType === 'image/png' ? 'image/png'
    : mimeType === 'image/webp' ? 'image/webp'
    : mimeType === 'image/gif' ? 'image/gif'
    : 'image/jpeg';
  return callClaudeWithImage(fileBase64, mt, prompt, systemPrompt);
}

// ─────────────────────────────────────────────────────────────────────────────
// [STATEMENT-RECONCILE] Het rekeningoverzicht LEZEN in plaats van alleen weigeren
// ─────────────────────────────────────────────────────────────────────────────
// Een rekeningoverzicht ("openstaande posten", "saldo-overzicht") is nooit een boekbare
// factuur — dat blijft zo, en de guards hierboven zorgen daarvoor. Maar het is wél de enige
// bron die van BUITEN vertelt welke facturen je zou moeten hebben. Deze lezer haalt de REGELS
// eruit (nummer, datum, bedrag, soort), zodat statement-reconcile.ts kan zeggen welke factuur
// de eigenaar mist. Er wordt hiermee niets geboekt: de uitkomst is een aanwijzing, en de
// eigenaar haalt daarna de echte factuur op.
//
// Waarom een aparte call en niet de gewone extractor: die geeft één factuurkop terug (één
// nummer, één bedrag). Een overzicht is per definitie een LIJST. Een overzicht komt zelden
// binnen, dus de extra call is goedkoop; hij loopt via dezelfde budget-/retryplumbing.

/** Eén regel zoals de leverancier hem afdrukt. Spiegelt StatementLine in statement-reconcile.ts. */
export interface StatementLineRead {
  invoice_number: string | null;
  date: string | null;
  amount: number | null;
  kind: 'invoice' | 'credit' | 'payment' | 'other';
  description: string | null;
}

export interface StatementRead {
  /** Wie het overzicht stuurde — de leverancier, nooit wijzelf. */
  vendor: string | null;
  /** De periode die het overzicht noemt, als hij in de kop staat. */
  period_from: string | null;
  period_to: string | null;
  /** Het saldo dat het overzicht zelf noemt (alleen ter controle — nooit geboekt). */
  total_open: number | null;
  lines: StatementLineRead[];
  /** False wanneer we er niets bruikbaars uit kregen; de aanroeper claimt dan niets. */
  ok: boolean;
}

const STATEMENT_FALLBACK: StatementRead = {
  vendor: null, period_from: null, period_to: null, total_open: null, lines: [], ok: false,
};

export async function readSupplierStatement(
  fileBase64: string,
  mimeType: string,
  filename: string,
  /** Onze eigen naam — het overzicht is AAN ons gericht; die naam is dus nooit de leverancier. */
  receiverName?: string | null,
): Promise<StatementRead> {
  const systemPrompt = `${SYSTEM_BASE}

Je leest een REKENINGOVERZICHT van een leverancier (een "statement of account": openstaande
posten, saldo-overzicht, openstaande facturen). Dit is GEEN factuur. Je taak is uitsluitend:
haal de REGELS eruit zoals ze gedrukt staan.

Geef ALLEEN een JSON-object terug (geen markdown, geen uitleg):
{
  "vendor": string or null,
  "period_from": "YYYY-MM-DD" or null,
  "period_to": "YYYY-MM-DD" or null,
  "total_open": number or null,
  "lines": [
    { "invoice_number": string or null,
      "date": "YYYY-MM-DD" or null,
      "amount": number or null,
      "kind": "invoice" | "credit" | "payment" | "other",
      "description": string or null }
  ],
  "ok": boolean
}

Regels:
- vendor: de AFZENDER van het overzicht (de leverancier), nooit de geadresseerde.
- Eén JSON-regel per gedrukte regel. Verzin NOOIT een regel en vul NOOIT een nummer, datum of
  bedrag aan dat er niet staat — laat het dan null. Een onvolledige regel is bruikbaar; een
  verzonnen regel maakt de hele controle onbetrouwbaar.
- kind: "invoice" voor een factuurregel, "credit" voor een creditnota, "payment" voor een
  ontvangen betaling van ons, "other" voor subtotalen, saldoregels, aanmaningskosten, rente.
- amount: het bedrag van de regel zoals gedrukt, als getal. Creditnota's en betalingen negatief.
  Punt als decimaalteken, geen duizendtalscheiding, geen valutateken.
- date: de FACTUURdatum van de regel (niet de vervaldatum) in YYYY-MM-DD. Onbekend ⇒ null.
- period_from/period_to: alleen als de kop een periode of peildatum noemt. Anders null.
- ok: true zodra je minstens één regel hebt kunnen lezen.
- Als dit document TOCH een gewone factuur blijkt (één factuur, geen lijst): geef ok=false en
  een lege lines-array. Dan is dit de verkeerde lezer en pakt de normale extractor het op.`;

  const who = receiverName ? `\nWij zijn de ONTVANGER van dit overzicht: "${receiverName}". Die naam is dus nooit de vendor.` : '';
  const prompt = `Lees dit rekeningoverzicht en geef de regels terug.
Bestandsnaam: ${filename}${who}

Let op: elke regel die de leverancier afdrukt is een factuur die WIJ zouden moeten hebben.
Neem ze allemaal mee, ook de regels die al betaald lijken.`;

  try {
    let result: string;
    if (mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
      // Een overzicht is bijna altijd een TEKST-pdf (uit een boekhoudpakket). De tekstweg is
      // goedkoper én leest een tabel met veel regels beter dan een pagina-afbeelding; lukt de
      // extractie niet (gescand), dan gaat de ruwe PDF alsnog naar het model.
      const text = await extractPdfTextIfTextLayer(fileBase64);
      result = text
        ? await callClaude(`${prompt}\n\n--- OVERZICHT TEKST (uit PDF) ---\n${text}`, systemPrompt)
        : await callClaudeWithPdf(fileBase64, prompt, systemPrompt);
    } else if (mimeType.startsWith('image/')) {
      const mt: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' =
        mimeType === 'image/png' ? 'image/png'
        : mimeType === 'image/webp' ? 'image/webp'
        : mimeType === 'image/gif' ? 'image/gif'
        : 'image/jpeg';
      result = await callClaudeWithImage(fileBase64, mt, prompt, systemPrompt);
    } else {
      return STATEMENT_FALLBACK;
    }

    const parsed = safeParseJSON<StatementRead>(result);
    if (!parsed || parsed.ok === false || !Array.isArray(parsed.lines)) return STATEMENT_FALLBACK;

    // Normaliseren + opschonen. Alles wat we niet vertrouwen wordt null — nooit een gok die
    // later als "ontbrekende factuur" op het scherm van de eigenaar belandt.
    const iso = (d: unknown): string | null =>
      typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.trim()) ? d.trim() : null;
    const num = (n: unknown): number | null =>
      typeof n === 'number' && Number.isFinite(n) ? n : null;
    const str = (s: unknown): string | null => {
      const t = typeof s === 'string' ? s.trim() : '';
      return t ? t.slice(0, 120) : null;
    };

    const lines: StatementLineRead[] = parsed.lines
      // Een overzicht met honderden regels is een import, geen controle — begrens het.
      .slice(0, 400)
      .map((l) => ({
        invoice_number: str(l?.invoice_number),
        date: iso(l?.date),
        amount: num(l?.amount),
        kind:
          l?.kind === 'credit' || l?.kind === 'payment' || l?.kind === 'other'
            ? l.kind
            : 'invoice',
        description: str(l?.description),
      }));

    const vendorRaw = str(parsed.vendor);
    // Onze eigen naam als leverancier is per definitie fout (het overzicht is AAN ons).
    const vendor =
      vendorRaw && receiverName && vendorRaw.toLowerCase() === receiverName.trim().toLowerCase()
        ? null
        : vendorRaw;

    return {
      vendor,
      period_from: iso(parsed.period_from),
      period_to: iso(parsed.period_to),
      total_open: num(parsed.total_open),
      lines,
      ok: lines.length > 0,
    };
  } catch (err) {
    // Nooit fataal: het bestand zelf is al veilig opgeslagen. Geen uitkomst = geen claim.
    console.warn('[STATEMENT-RECONCILE] kon het overzicht niet lezen', err);
    return STATEMENT_FALLBACK;
  }
}
