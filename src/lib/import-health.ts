// src/lib/import-health.ts
// [IMPORT-MONITOR] Part 1 — read-time import-health classification.
//
// PURPOSE: turn the signals that ALREADY exist on an incoming invoice into a
// single, plain-language health verdict the owner can act on. This is VISIBILITY
// over existing validation, not new validation (§4). It writes nothing, runs no
// migration, and reuses the EXACT arithmetic gate from @/lib/safecore.
//
// Two signal sources, both already present per import:
//   1. field_confidence._safecore  — the stored arithmetic hold reason, written
//      by the EMAIL path at import time when the math failed (BOEK-SAFECORE).
//   2. field_confidence.{vendor,invoice_number,invoice_date} — the AI's per-field
//      confidence (BRIDGE-EXTRACT).
//
// 🔴 THE UPLOAD-PATH COMPENSATION: the upload path holds every invoice in
// 'processing' but NEVER runs the arithmetic gate, so it never writes _safecore.
// A manually-uploaded invoice with excl+BTW≠incl would otherwise look identical
// to a clean one. So when _safecore is ABSENT, we recompute the verdict here, at
// read-time, over the stored amounts — using the same evaluateArithmetic. This
// gives correct health for BOTH paths even before SAFECORE-UPLOAD-1 fixes the
// upload path's write-time gate.
//
// HEALTH vs FLOW (the two-axis model — see IMPORT-MONITOR Part 2):
//   - health  = "is anything WRONG?" (arithmetic / low-confidence) → this file.
//   - flow    = "is anything waiting to be SENT onward?" → simply: it's pending.
// A clean-but-unsent invoice is healthy (no warning) AND waiting-to-flow. This
// file answers ONLY the health axis; the flow axis is just "is it in the queue",
// which the page already knows. Keeping them separate is what lets a clean
// upload read "✓ ready to confirm" (calm) instead of "review this" (alarm).

import { evaluateArithmetic, isPlaceholderInvoiceNumber } from '@/lib/safecore'
// [GEGROND-NAAM] De zin hoort bij de regel, niet bij het scherm — zie het blok dat hem gebruikt.
import { vendorGroundingText } from './vendor-grounding'
// [SOM-IS-GROND] Een niet-gedrukt totaal dat exact de som is van twee bedragen die er WEL staan.
import { totalIsDerivedFromGrounded } from './amount-grounding'
// [E-FACTUUR] De cijfers die de leverancier zelf meestuurde — sterker dan elke lezing.
import { eInvoiceOf, eInvoiceSettlesAmounts } from '@/lib/e-invoice'
// [DOCCHECK-SPLIT] € 1.234,56 in de zin die zegt wat er op het document staat.
import { formatEuroNL } from './format-nl'
// [IBAN-WISSEL] Eén formulering voor "dit rekeningnummer is veranderd", gedeeld met het importpad.
import { ibanChangeReason } from '@/lib/iban-change'
// [CREDIT-PREFIX-GATE] One shared list of credit prefixes. A second copy here would drift from the
// one the payment screen reads, and two screens disagreeing about what a credit note is is how the
// same money goes the wrong way twice.
import { looksLikeCreditnotaByNumber, numberPrefix } from '@/lib/creditnota-signal'
// [BTW-SPLIT] The per-rate block, and what it is worth as evidence. Pure; imports nothing back.
import { classifyBtwSplit } from '@/lib/btw-split'

// [LEVERANCIER-STAAT-IN-HET-LOGO] One threshold, one file. Re-exported because this module's own
// consumers have always read it from here — see confidence.ts for why it may not be copied.
export { LOW_CONFIDENCE } from '@/lib/confidence'
import { LOW_CONFIDENCE } from '@/lib/confidence'

/** Dutch money formatting for an owner-facing reason. Local so this module stays dependency-free. */
function formatEuro(v: number): string {
  const [whole, cents] = Math.abs(v).toFixed(2).split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${v < 0 ? '− ' : ''}€ ${grouped},${cents}`
}

/**
 * [ANDER-TOTAAL] What the owner reads when the document's own totals block disagrees with the read.
 *
 * Both numbers, in the order the eye needs them: what we said, then what the paper says, then the
 * sum that proves the second one is a totals block and not two amounts that happened to be near
 * each other. A question — the owner is holding the invoice and can settle it in a glance.
 */
function alternativeReason(alt: { ex: number; btw: number; inc: number }): string {
  return (
    'het totaalbedrag dat wij lazen staat niet op dit document — er staat wél ' +
    `${formatEuro(alt.ex)} + ${formatEuro(alt.btw)} btw = ${formatEuro(alt.inc)}; ` +
    'controleer welk bedrag op de factuur staat'
  )
}

export type HealthLevel = 'clean' | 'needs-review'

export interface ImportHealth {
  level: HealthLevel
  // Plain-language Dutch reasons, owner-facing. Empty when level === 'clean'.
  reasons: string[]
  /**
   * [ANDER-TOTAAL] A totals block that IS on the document, when the one we read is not.
   *
   * Travels with the verdict rather than being re-derived on the screen: the card and the confirm
   * modal would each need the same reach into field_confidence._grounding, and two derivations of
   * one fact is how they come to disagree. Present only when the read total was found to be absent
   * from the document AND the witness's own amounts contain a block that adds up.
   */
  alternativeTotals?: { ex: number; btw: number; inc: number }
  // Machine-readable detail for the card/modal to highlight the right fields.
  flags: {
    arithmetic: boolean // a math problem (stored _safecore OR recomputed)
    vendor: boolean // AI unsure about the supplier
    invoiceNumber: boolean // AI unsure about the invoice number
    invoiceDate: boolean // AI unsure about the date
    reminder: boolean // [REMINDER] a payment reminder — check the original isn't already booked
    possibleDuplicate: boolean // [DEDUP-SOFT] a look-alike of an invoice already imported — human glance
    // [IBAN-WISSEL] A supplier we already know arrived with a DIFFERENT bank account. The
    // signature of invoice fraud — and the one axis every other gate here reads as clean.
    ibanChanged: boolean
    // [MULTI-INVOICE] The uploaded file looks like it holds SEVERAL different invoices. Only one
    // of them was read; the others exist nowhere. Never auto-book such a row, and tell the owner.
    multipleInvoices: boolean
    // [CREDIT-PREFIX-GATE] The document NUMBER carries a credit marker (CR…, CN…) while the row is
    // booked as a debt. Not a verdict — a refusal to let it skip the human. See the function's
    // header in creditnota-signal.ts for why this bar is lower than the sign-flip bar.
    creditPrefix: boolean
    /**
     * [NIET-OP-HET-DOCUMENT] The read total was not found in the blind transcription of this
     * document. A finding in its own right — and NOT an arithmetic problem, which is what it used
     * to be filed as.
     *
     * The two share `arithmetic` because both mean "do not book this unseen", and that part is
     * right. What was wrong is the SENTENCE the checklist then printed: "excl. + btw komt niet uit
     * op het totaal", on the measured invoice where 1.123,62 + 101,13 = 1.224,75 exactly. An owner
     * who checks that claim finds it false, and a check that is caught lying once is a check nobody
     * reads again — including on the invoice where it is right.
     */
    notOnDocument: boolean
    /**
     * [SUBTOTAAL] The amount we read as the total IS on the document — but not where a total sits:
     * it carries no total label and it is not the largest amount on the page. That is exactly what
     * a subtotal, a line amount and the BTW amount look like.
     *
     * A sibling of `notOnDocument`, and it exists for the same reason that one does. Both mean
     * "the figure we call the total is not established as this document's total", both share
     * `arithmetic` so neither books itself unseen — and the sentence the checklist prints for an
     * arithmetic mismatch is false for both. `notOnDocument` was carved out when that lie was
     * measured on BALKIP 264091; this branch was left behind and kept printing it. Measured on
     * Enka Horeca 26713540: "Bedragen kloppen niet" over 1.431,19 + 128,78 = 1.559,97, which is
     * exact to the cent, on a card that shows the owner all three numbers.
     */
    totalLooksLikeSubtotal: boolean
  }
}

// The amounts the classifier needs — a structural subset of the invoice row.
export interface HealthInput {
  total_ex_btw: number | null
  btw_amount: number | null
  total_inc_btw: number | null
  invoice_date: string | null
  // [TRUST-NUMBER] The STORED invoice number. The email path stores a fabricated
  // placeholder (EMAIL-<ts>) when the reader returned none, and the AI's per-field
  // confidence score defaults to 1 for a missing field — so a fabricated number reads
  // "clean" with no trace. Passing the value lets health flag a missing/placeholder
  // number. Optional so existing call sites keep compiling (undefined → not checked).
  invoice_number?: string | null
  // [BRIDGE-CREDITNOTA-SIGN] 'creditnota' → the recompute below takes the
  // sign-inverted gate (amounts must be NEGATIVE + consistent). Optional so
  // existing call sites keep compiling; absent/other → the standard gate.
  invoice_type?: string | null
  // field_confidence is jsonb: AI per-field scores PLUS an optional nested
  // _safecore object (present only when the email path held the invoice).
  field_confidence: FieldConfidence | null
}

// The runtime shape of the jsonb. The AI scores are flat keys; _safecore is a
// nested object written by BOEK-SAFECORE. Both optional — a clean email import
// stores null; a clean upload stores only AI scores (or null).
export interface FieldConfidence {
  vendor?: number
  invoice_number?: number
  invoice_date?: number
  // [TRUST-AMOUNTS] The money-truth's OWN confidence channel. The AI may emit any
  // of these for the amounts it read; we take the lowest present. Before this, the
  // amounts — the one set of facts that IS the money — carried no confidence at all,
  // so a confidently-wrong read (€121 → €109, internally consistent) passed clean.
  amount?: number
  total?: number
  total_inc_btw?: number
  // [BTW-SUM-FIX] Present when the printed BTW total could not be read from a mixed-rate summary
  // block and was derived from excl + the paid total (see fixMisSummedBtw in @/lib/ai). The
  // amounts add up again, so every other axis goes quiet — which is exactly why this needs its
  // own reason: the figure is OUR arithmetic, and BTW is deductible money in the aangifte.
  _btw_derived?: { read?: number | null; used?: number | null }
  // [EIGEN-CONTROLE-ONBEKEND] De eigen-verkoopfactuurcontrole kon niet draaien — zie ai.ts.
  _own_check_unavailable?: boolean
  // [VERLEGD-NAAR-MIJ] De leverancier heeft de BTW naar deze eigenaar verlegd: geen BTW en geen
  // tarief op het document is dan juist. Alleen vastgelegd; de aangifte doet er iets mee
  // (rubriek 2a, dezelfde euro's terug in 5b). Hier staat hij omdat een nul-BTW die door de
  // verlegging verklaard wordt geen leesfout is — zie zero-btw.ts.
  _btw_verlegd?: { grondslag?: number | null }
  // [NUL-BTW-STIL] An ingestion door booked a zero BTW that the document does not explain — see
  // zero-btw.ts. Written by the door, never by the reader: it describes what was STORED. The row
  // needs its own reason because the gross-as-net fallback makes ex equal incl, so the arithmetic
  // is silent by construction and the voorbelasting sits at 0 behind a clean-looking row.
  _btw_zero_unexplained?: boolean
  // [VREEMDE-VALUTA] The document named a currency that is not the euro. The stored amounts are
  // the PRINTED ones — nothing converted them, because a conversion needs the rate on the invoice
  // date and this app has none. So every figure on this row is in `code`, not in euros, and the
  // owner is the only one who can supply what their bank actually took.
  _valuta?: { code?: string | null }
  // [ZELFFACTUUR] Het document zegt zelf dat de AFNEMER hem heeft opgemaakt (zelffacturering).
  // Aan welke kant de eigenaar staat bepaalt of dit eigen omzet is of een echte inkoop, en dat
  // staat nergens op het papier — dus één blik van een mens, nooit een gok.
  _zelffactuur?: boolean
  // [ASSURANTIE] Present when the document printed assurantiebelasting (insurance premium tax) and
  // a non-zero amount had been read into btw_amount. The guard (stripAssurantiebelastingBtw in
  // @/lib/ai) removed it from the deductible column and folded it into the cost. Says so out loud:
  // that tax is a real cost but never voorbelasting, and the change was ours — a human confirms,
  // and it can never auto-book. `read` is the amount that had been misread as BTW.
  _assurantiebelasting?: { read?: number | null }
  // [EX-INCL-FIX] The base was rewritten from incl − btw because the printed "Subtotaal" equalled
  // the gross while a real BTW stood beside it (an impossible pair). The repaired amounts add up
  // by construction, so nothing else would mention it — and the base is what books as kosten.
  _ex_corrected?: { read?: number | null; used?: number | null }
  // [BTW-SPLIT] The per-rate summary block as PRINTED — one row per rate, grondslag on the left,
  // btw on the right. It is the only independent witness a MIXED-RATE invoice has: with two rates
  // in play, btw/excl can legally be anything between them, so the rate check self-disables and
  // the sum identity is the only constraint left over three numbers. Which is no constraint at
  // all, because whoever produced the triplet can always satisfy it by moving the third figure.
  // See btw-split.ts for the invoice that proved it.
  _btw_rows?: { rate: number; base: number; btw: number }[]
  // [REGELS] Een tariefverdeling die WIJ uit de factuurregels hebben opgebouwd, en alleen bewaard
  // wanneer die beide gedrukte ankers reproduceerde — het excl. totaal én de btw. Ander bewijs dan
  // _btw_rows: dat drukte de leverancier, dit volgt uit de goederen zelf.
  _btw_rows_uit_regels?: { rate: number; base: number; btw: number }[]
  // [PRINTED-TOTAL] "Totaal te voldoen" exactly as printed, before any arithmetic of ours. Stored
  // separately from total_inc_btw precisely so the two can DISAGREE — the moment we let the reader
  // reconcile them, the disagreement (the whole signal) is gone.
  _total_printed?: number | null
  // [PRINTED-TOTAL] Set when WE computed one of the three amounts because the reader returned only
  // the other two. The identity then holds by construction, so "excl + btw = totaal" is no longer
  // a check that passed — it is a check that could not run. The checklist reports it as such.
  _total_derived?: 'total' | 'excl'
  // [BON-NUMMER] Wat voor document dit is, gezet door /api/intake. 'receipt' = kassabon.
  // Een kassabon draagt geen factuurnummer en hoeft dat ook niet: hij is een vereenvoudigde
  // factuur, geen art. 35-factuur. De nummer-as hieronder wordt daarom voor een bon
  // overgeslagen — anders krijgt élke bon een amberen "Aandacht nodig" voor iets wat er niet
  // hoort te staan, en verdrinkt het echte signaal in ruis waar niemand meer naar kijkt.
  _intake_kind?: string
  /**
   * [E-FACTUUR] Wat de leverancier zelf over het geld zei, in machinevorm — geschreven door de
   * lezer (ai.ts) wanneer er Factur-X/ZUGFeRD/Peppol-XML in het bestand zat.
   *
   * Hier alleen GEDECLAREERD, niet uitgelezen: elke lezer gaat door eInvoiceOf() /
   * eInvoiceSettlesAmounts() in e-invoice.ts, want dit is jsonb en een veld dat je zonder
   * validatie gelooft is een veld dat je kunt vervalsen door onzin op te slaan. Het staat in deze
   * interface omdat het er in de database echt is, en een type dat een bestaande sleutel verzwijgt
   * dwingt elke aanroeper tot een cast — en een cast is precies waar de validatie verdwijnt.
   */
  _einvoice?: unknown
  _safecore?: {
    arithmetic_ok?: boolean
    reason?: string
    flags?: string[]
    held_at?: string
    dedup?: string
    dedup_reason?: string
    // [REMINDER] This invoice was read as a payment reminder — the original may already be
    // booked, so it needs a human check (never bulk-confirmed as a second cost).
    reminder?: boolean
    reminder_of?: string
    // [DEDUP-SOFT] This invoice looked like a POSSIBLE (not confident) duplicate at import — same
    // amount + date, or same amount + vendor a few days apart. It was NOT blocked (too uncertain to
    // reject), but the human should check it isn't a double booking. `_of` names the look-alike.
    possible_duplicate?: boolean
    possible_duplicate_of?: string
    // [SUPERSEDE] The id of the look-alike, so the queue can offer "Deze vervangt factuur X" and
    // the server can act on an exact row rather than on a display string. Absent on rows imported
    // before this existed — the flag still shows, only the one-tap button does not.
    possible_duplicate_id?: string
    possible_duplicate_reason?: string
    // [IBAN-WISSEL] Written at import time when a supplier we already hold under one bank account
    // sends an invoice with another one. `_from` / `_to` carry both numbers so the read-time reason
    // can show them side by side — comparing them IS the check the owner has to make.
    iban_changed?: boolean
    iban_changed_from?: string
    iban_changed_to?: string
    // [IBAN-CHECK-HONEST] De keerzijde van de vlag hierboven, in dezelfde geest als
    // [ONE-INVOICE-UNVERIFIED]: niet "het nummer is gewijzigd", maar "we konden het niet nagaan".
    // De leveranciersregistratie was onbereikbaar, dus er is niets vergeleken. Bij factuurfraude
    // klopt de rekensom juist wél en is het rekeningnummer het enige signaal — dus een controle
    // die stil is overgeslagen mag niet als een geslaagde controle ogen.
    iban_check_unavailable?: boolean
    // [EERSTE-KEER] Er was NIETS om mee te vergelijken: dit is het eerste rekeningnummer dat we van
    // deze leverancier zien. Een derde geval naast "gewijzigd" en "kon niet nagaan", en het stond er
    // niet — waardoor het samenviel met "vergeleken en ongewijzigd", dat de enige is die een vinkje
    // verdient. Gemeten op één administratie: 72 facturen, € 63.128,41, allemaal groen afgevinkt op
    // het ene moment dat er geen enkele geschiedenis was om een misgelezen cijfer of een omgeleide
    // betaling mee te betrappen.
    iban_first_seen?: boolean
    // [CREDIT-WOORD] Bij de intake gezet toen het WOORD "creditnota" (of een variant) in de KOP van
    // het document stond terwijl de lezing er een gewone factuur van maakte. De tweede
    // deterministische greep naast de nummerprefix, en de enige die ook werkt bij een leverancier
    // die zijn creditnota's in dezelfde nummerreeks zet. Zie creditWordInHeader.
    credit_word_in_header?: boolean
    // [MULTI-INVOICE] Written at import time when one uploaded PDF carried several different
    // labelled invoice numbers, each with its own settlement. The reader returns ONE invoice, so
    // the rest were silently lost — the reason below names the numbers so the owner can go and
    // add them separately.
    multiple_invoices?: boolean
    multiple_invoices_reason?: string
    // [ONE-INVOICE-UNVERIFIED] De keerzijde van de vlag hierboven: niet "we zagen meerdere
    // facturen", maar "we konden het niet nagaan". Een gescande meerpagina-PDF heeft geen
    // tekstlaag, en detectMultipleInvoices leest juist die tekstlaag — dus bij precies de stapel
    // waarvoor die controle bestaat, kijkt hij nergens naar.
    one_invoice_unverified?: boolean
    one_invoice_unverified_reason?: string
  }
}

/**
 * [IMPORT-MONITOR] Classify one incoming invoice's import health.
 *
 * Pure: no DB, no I/O. Reads stored signals; recomputes arithmetic only when the
 * stored _safecore is absent (the upload-path compensation). Never mutates input.
 */
/**
 * [BON-NUMMER] Is dit een kassabon?
 *
 * Alleen de nummer-as hangt hiervan af — een bon draagt geen factuurnummer en hoeft dat niet.
 * Alle andere assen (rekenwerk, bedragen, datum, dubbel) blijven onverkort gelden: die gaan
 * over geld, en geld is op een bon net zo hard als op een factuur.
 *
 * De bron is _intake_kind uit field_confidence, gezet door /api/intake. Dat is een jsonb-veld
 * en dus niet als SQL te bevragen; voor een WEERGAVE-beslissing als deze is dat aanvaardbaar.
 * Zou er ooit een FISCALE regel aan bonnen worden opgehangen, dan hoort daar eerst een echte
 * kolom bij (invoice_type = 'bon'), niet dit veld.
 */
function isKassabon(fc: FieldConfidence | null | undefined): boolean {
  return fc?._intake_kind === 'receipt'
}

export function classifyImportHealth(inv: HealthInput): ImportHealth {
  const reasons: string[] = []
  const flags = {
    arithmetic: false,
    vendor: false,
    invoiceNumber: false,
    invoiceDate: false,
    reminder: false,
    possibleDuplicate: false,
    ibanChanged: false,
    multipleInvoices: false,
    creditPrefix: false,
    notOnDocument: false,
    totalLooksLikeSubtotal: false,
  }

  const fc = inv.field_confidence

  // ── Arithmetic axis ──────────────────────────────────────────────────────
  // Prefer the STORED reason (email path wrote it at import time). If absent,
  // recompute over the stored amounts (upload path never ran the gate). Either
  // way the source of truth is the same evaluateArithmetic logic.
  const storedSafecore = fc?._safecore
  // ── Reminder axis ────────────────────────────────────────────────────────
  // [REMINDER] A payment reminder is a real single invoice, but the original was very likely
  // already received — so this needs a human check before it's confirmed, to avoid booking the
  // same debt twice. Flag it (→ needs-review, excluded from bulk-confirm) with a clear reason.
  if (storedSafecore?.reminder === true) {
    flags.reminder = true
    reasons.push(
      storedSafecore.reminder_of
        ? `dit lijkt een herinnering voor factuur ${storedSafecore.reminder_of} — controleer of die al geboekt is`
        : 'dit lijkt een betalingsherinnering — controleer of de originele factuur al geboekt is'
    )
  }
  // [DEDUP-SOFT] A POSSIBLE (not confident) duplicate — same amount + date, or same amount +
  // vendor a few days apart. It was allowed in (too uncertain to block), but must never be
  // bulk-confirmed as a second cost without a human glance. → needs-review with a clear "mogelijk
  // dubbel met X" reason.
  if (storedSafecore?.possible_duplicate === true) {
    flags.possibleDuplicate = true
    const of = storedSafecore.possible_duplicate_of
    const why = storedSafecore.possible_duplicate_reason
    reasons.push(
      `mogelijk dubbel${of ? ` met factuur ${of}` : ''}${why ? ` (${why})` : ''} — controleer of dit geen dubbele boeking is`
    )
  }
  // [GEGROND] Het bedrag dat de lezer opgaf staat NIET in de tekst van het document zelf.
  //
  // Dit staat bewust hier, hoog en apart, want het is de ENIGE controle in dit bestand die niet de
  // lezer naar zijn eigen antwoord vraagt. De rekenkundige poort vergelijkt drie getallen die één
  // en dezelfde lezing produceerde, en field_confidence is zijn mening over zijn eigen mening — een
  // lezing die consistent fout is komt daar ongeschonden doorheen. Dat is precies wat er gebeurde
  // bij de € 0,46-fout, en het is de reden dat een ondernemer de papieren factuur ernaast houdt.
  //
  // Alleen 'absent' spreekt. 'unreadable' is een foto of scan — dan is er geen tekst om in te
  // zoeken, en "staat niet op je factuur" zeggen over een foto is een leugen die ervoor zorgt dat
  // de échte waarschuwingen ook niet meer gelezen worden.
  // [ANDER-TOTAAL] Set below when the read total is absent from the document and the witness's
  // own amounts contain a block that adds up.
  let alternativeTotals: { ex: number; btw: number; inc: number } | undefined
  const grounding = (fc as unknown as {
    _grounding?: {
      totalIncBtw?: string; totalExBtw?: string; btwAmount?: string
      alternative?: { ex: number; btw: number; inc: number }
    }
  } | null)?._grounding
  // [SOM-IS-GROND] Een totaal dat niet op het papier staat maar exact de som is van twee bedragen
  // die er WEL letterlijk staan, is geen gok — het is rekenwerk over bewijs, en dat is het sterkste
  // wat er is op een factuur die haar eigen totaal niet herhaalt.
  //
  // Gemeten: 53 van de 53 gegronde facturen van GROOTHANDEL M.H. BAL (de grootste leverancier van
  // deze eigenaar, 96 stuks) hebben excl 'found', btw 'found' en incl 'absent' — en tellen elke
  // keer exact op. Elke andere leverancier scoort 0 of 1. Dit was dus geen leesfout maar één
  // factuurlay-out, 53 keer aangezien voor een probleem.
  //
  // Deze controle staat HIER en niet alleen bij het inlezen, want dan zouden de 53 bestaande rijen
  // hun waarschuwing houden: het oordeel staat opgeslagen, de bedragen ook, dus het bewijs is
  // achteraf net zo goed na te rekenen als op het moment zelf.
  const somIsGrond = totalIsDerivedFromGrounded(
    grounding as Parameters<typeof totalIsDerivedFromGrounded>[0],
    { totalIncBtw: inv.total_inc_btw, totalExBtw: inv.total_ex_btw, btwAmount: inv.btw_amount },
  )
  if (grounding?.totalIncBtw === 'absent' && !somIsGrond) {
    // Both: `arithmetic` still holds this row out of auto-booking (it always did, and that is
    // right), while `notOnDocument` says WHICH finding it is so the checklist can stop describing
    // it as a sum that does not add up. See the flag's own comment.
    flags.arithmetic = true
    flags.notOnDocument = true
    // [ANDER-TOTAAL] "controleer het aan de factuur zelf" was true and, on its own, a dead end: it
    // sends the owner to find the paper. The witness that just proved the read total is not printed
    // also transcribed what IS printed — and when those amounts contain a block that adds up, the
    // app can put the question on the screen instead. Measured on the invoice this came from: read
    // EUR 1.149,56, document 1.065,14 + 95,54 = 1.160,68. Eleven euro of cost and sixty-two cents
    // of voorbelasting, on a document the app had already flagged as unverified.
    //
    // Shown, never applied: both figures come from a model reading a scan, and naming a winner
    // would be the same overconfidence that produced the wrong number.
    reasons.push(
      grounding.alternative
        ? alternativeReason(grounding.alternative)
        : 'het totaalbedrag staat niet letterlijk in de tekst van dit document — controleer het aan de factuur zelf',
    )
    // Carried out so the confirm modal can offer it as one tap, the way [ONE-TAP-REPAIR] already
    // does for an arithmetic mismatch. A warning that names a figure and then makes the owner
    // retype it is asking them to copy a number the app is holding.
    if (grounding.alternative) alternativeTotals = grounding.alternative
  }

  // [GEGROND-NAAM] Dezelfde vraag over de NAAM, en tot nu toe stelde niemand hem.
  //
  // Gemeten: een factuur van BALKIP B.V. — eigen briefhoofd, eigen KVK, eigen IBAN, verstuurd
  // vanaf info@balkip.nl — kwam binnen als "GROOTHANDEL M.H. BAL V.O.F.". Een ander bedrijf. De
  // drie bedragen waren goed gelezen en dat werd ook gemeld; het ENIGE veld dat fout was, was het
  // enige veld zonder controle erop.
  //
  // Het is geen etiket. invoices.client_name is de identiteitssleutel waarmee knownIbanForVendor
  // de leverancier opzoekt — de controle die tussen de ondernemer en een omgeleide betaling staat.
  // Een naam die als een ANDER bedrijf wordt gelezen zakt daar niet voor: hij zoekt een andere
  // leverancier op en komt schoon door.
  //
  // Blokkeert met opzet niets. Veel facturen drukken hun naam alleen in een logo af, en dat is een
  // afbeelding zonder letters — dan heeft een volkomen juiste lezing niets te vinden. Daarom
  // spreekt alleen 'absent', en spreekt het als "kijk hier even naar", nooit als "dit is fout".
  const vendorGrounding = (fc as unknown as {
    _vendorGrounding?: { verdict?: string; name?: string | null }
  } | null)?._vendorGrounding
  if (vendorGrounding?.verdict === 'absent') {
    // `vendor`, niet `arithmetic`: het is de LEVERANCIER die niet klopt, en de kaart moet dat veld
    // kunnen aanwijzen. De bedragen waren op de gemeten factuur juist — ze aanwijzen zou de
    // ondernemer naar het enige deel sturen dat wél goed was.
    flags.vendor = true
    // The sentence comes from vendor-grounding.ts, where the verdict does. It stood written out
    // here as well — word for word — which meant the copy beside the rule had no caller at all,
    // and a future edit there would have changed nothing while looking like changing what the
    // owner reads.
    const zin = vendorGroundingText('absent', vendorGrounding.name ?? null)
    if (zin) reasons.push(zin)
  }

  // [DOCCHECK] En de scherpere vorm van dezelfde vraag. 'present' betekent: het bedrag STAAT wel op
  // het document, maar niet op de plek waar een totaal staat — het draagt geen totaal-label en het
  // is niet het hoogste bedrag op de pagina. Dat is precies hoe een SUBTOTAAL, een REGELBEDRAG en
  // het BTW-bedrag eruitzien, en gemeten op een echte factuur kwamen alle drie die foute lezingen
  // hierboven als 'gevonden' door.
  const doccheck = (fc as unknown as {
    _doccheck?: { total?: string; date?: string; btwContradiction?: { excl: number; btw: number; rate: number } | null }
  } | null)?._doccheck
  if (doccheck?.total === 'present') {
    // Both, for the reason the flag's own comment gives: `arithmetic` keeps the row out of
    // auto-booking (that part was always right), and the sibling flag says WHICH finding it is so
    // the checklist can stop calling it a sum that does not add up.
    flags.arithmetic = true
    flags.totalLooksLikeSubtotal = true
    reasons.push(
      'dit bedrag staat wél op het document, maar niet waar het totaal staat — het lijkt een ' +
      'subtotaal of een regelbedrag. Controleer welk bedrag het totaal is.',
    )
  }
  // De datum had tot nu toe helemaal geen getuige, terwijl hij bepaalt in welk kwartaal de BTW
  // valt. Geen blokkade — een factuur die zijn datum in een onvoorzien formaat afdrukt zou dan
  // blijven hangen — maar wél gezegd.
  if (doccheck?.date === 'absent') {
    reasons.push('de factuurdatum staat niet zo op het document — controleer of de datum klopt')
  }
  // [DOCCHECK-SPLIT] Het document drukt een ANDERE btw-splitsing af dan er gelezen is. Dit is de
  // vorm van de allereerste fout die dit hele spoor begon (€ 0,46): het totaal klopte, de rekensom
  // klopte, en alleen de splitsing was verzonnen — waardoor geen enkele poort hem tegenhield.
  // De zin noemt wat er OP HET PAPIER staat, want dat is het antwoord en niet alleen het probleem.
  const contra = doccheck?.btwContradiction
  if (contra) {
    flags.arithmetic = true
    reasons.push(
      `op het document staat ${formatEuroNL(contra.excl)} + ${formatEuroNL(contra.btw)} btw (${contra.rate}%) — ` +
      'dat is een andere btw dan hier is gelezen. Neem het bedrag van de factuur over.',
    )
  }

  // [MAILTEKST] Dit "document" is door ons gemaakt van de tekst van een e-mail, omdat de
  // leverancier niets meestuurde. Dat is geen fout — de kosten zijn echt en de voorbelasting is
  // echt — maar de eigenaar hoort te weten waar hij naar kijkt voordat hij bevestigt: bij een
  // geschil weegt een door ons opgemaakte pagina anders dan de PDF van de leverancier zelf.
  if ((fc as { _mailtekst?: unknown } | null | undefined)?._mailtekst === true) {
    reasons.push(
      'deze factuur stond in de TEKST van een e-mail, zonder bijlage — wij hebben die tekst ' +
      'bewaard als document. Controleer de bedragen en vraag de leverancier zo nodig om een PDF',
    )
  }

  // [E-FACTUUR] De leverancier stuurde zijn cijfers ZELF mee, in machinevorm (Factur-X / ZUGFeRD /
  // Peppol), en die spreken het gelezen bedrag tegen. Dit is de enige controle in het hele bestand
  // die niet naar de lezing kijkt maar naar de factuur zelf: rekensom, plaatsing, zekerheid en
  // splitsing kunnen alle vier kloppen terwijl het gewoon het verkeerde getal is.
  //
  // De zin noemt het juiste bedrag. Wij passen het niet zelf aan — dat blijft aan de ondernemer —
  // maar hem laten zoeken naar iets wat de app al weet, is geen controle maar een raadsel.
  const efact = eInvoiceOf(fc)
  if (efact?.contradicts) {
    flags.arithmetic = true
    reasons.push(
      `de leverancier stuurde een e-factuur mee en daarin staat ${formatEuroNL(efact.totalIncBtw)} ` +
      `(${formatEuroNL(efact.totalExBtw)} + ${formatEuroNL(efact.btwAmount)} btw) — ` +
      'dat is een ander bedrag dan hier is gelezen. Neem het bedrag uit de e-factuur over.',
    )
  }

  // [IBAN-WISSEL] Een bekende leverancier met een ander rekeningnummer. Dit staat bewust boven de
  // rekenkundige as: bij factuurfraude klopt de rekensom juist wél — het bedrag is overgenomen van
  // een echte factuur. Elke andere poort hier geeft groen, dus als deze zwijgt, zwijgt alles.
  if (storedSafecore?.iban_changed === true) {
    flags.ibanChanged = true
    const from = storedSafecore.iban_changed_from
    const to = storedSafecore.iban_changed_to
    reasons.push(
      from && to
        ? ibanChangeReason({ from, to })
        : 'het rekeningnummer van deze leverancier is veranderd — controleer dit vóór je betaalt, ' +
          'en bel de leverancier op een nummer dat je zelf opzoekt (niet het nummer op deze factuur)'
    )
  }
  // [IBAN-CHECK-HONEST] De controle kon niet draaien. Zelfde vlag als een echte wissel, en dus
  // dezelfde gevolgen (needs-review, buiten "Selecteer klaar", geen automatische boeking) — want
  // het risico dat de vlag afdekt is hier niet kleiner, alleen ongemeten. Alleen de zin verschilt:
  // hij belooft geen wissel die we niet hebben gezien.
  else if (storedSafecore?.iban_check_unavailable === true) {
    flags.ibanChanged = true
    reasons.push(
      'we konden het rekeningnummer van deze leverancier nu niet vergelijken met wat we eerder ' +
      'van hem kenden — controleer het zelf vóór je betaalt, en bel bij twijfel op een nummer dat ' +
      'je zelf opzoekt (niet het nummer op deze factuur)'
    )
  }
  // [MULTI-INVOICE] Eén bestand, meerdere facturen. Dit staat bewust hoog: alle andere assen
  // kijken naar de factuur die WEL is ingelezen, en die kan volmaakt in orde zijn. Het probleem
  // is wat er NIET is ingelezen — de facturen uit hetzelfde bestand die nergens bestaan. Zwijgt
  // deze, dan zwijgt alles, en de eigenaar merkt het pas als zijn boekhouder het niet meer kan
  // repareren.
  if (storedSafecore?.multiple_invoices === true) {
    flags.multipleInvoices = true
    reasons.push(
      storedSafecore.multiple_invoices_reason ||
        'dit bestand lijkt meerdere facturen te bevatten — er is er maar één ingelezen; voeg de andere los toe'
    )
  }
  // [ONE-INVOICE-UNVERIFIED] Zelfde as, andere grond: hierboven ZAGEN we meerdere facturen, hier
  // konden we het niet nagaan. Dezelfde vlag, want de vraag die de eigenaar moet beantwoorden is
  // dezelfde ("zitten er meer facturen in dit bestand?") en elke lezer van deze as — de badge, de
  // needs-review, het uitsluiten van auto-bevestigen — hoort er hetzelfde op te reageren. Alleen
  // de reden verschilt, en die is wat hij leest: nooit beweren dat we iets zagen wat we niet zagen.
  else if (storedSafecore?.one_invoice_unverified === true) {
    flags.multipleInvoices = true
    reasons.push(
      storedSafecore.one_invoice_unverified_reason ||
        'we konden niet nagaan of dit bestand één factuur bevat of meerdere — controleer het zelf'
    )
  }
  if (storedSafecore && storedSafecore.arithmetic_ok === false) {
    flags.arithmetic = true
    // The stored reason is already owner-facing Dutch (e.g. "excl + BTW ≠ totaal").
    if (storedSafecore.reason) reasons.push(storedSafecore.reason)
    else reasons.push('mogelijke rekenfout in de bedragen')
  } else if (!storedSafecore || storedSafecore.arithmetic_ok === undefined) {
    // No stored arithmetic verdict → recompute. Covers the upload path, legacy rows, AND a
    // _safecore that carries ONLY a non-arithmetic flag (e.g. the intake path writes
    // possible_duplicate without ever running the arithmetic gate) — without this, an invoice
    // that is BOTH a possible-duplicate and arithmetically inconsistent would hide the math error.
    // [BRIDGE-CREDITNOTA-SIGN] Same gate, same branch selection as write time:
    // a creditnota row (invoice_type) takes the sign-inverted gate, so a clean
    // negative creditnota reads "ready" here instead of a false "Aandacht nodig".
    const verdict = evaluateArithmetic(
      {
        totalExBtw: inv.total_ex_btw,
        btwAmount: inv.btw_amount,
        totalIncBtw: inv.total_inc_btw,
        invoiceDate: inv.invoice_date,
      },
      { isCreditNote: inv.invoice_type === 'creditnota' }
    )
    if (!verdict.ok) {
      flags.arithmetic = true
      if (verdict.reason) reasons.push(verdict.reason)
      else reasons.push('mogelijke rekenfout in de bedragen')
    }
  }
  // (If storedSafecore exists AND arithmetic_ok !== false, the email path held
  //  it for a dedup note only, not a math problem — not a health warning here.)

  // [BTW-SUM-FIX] The reader could not sum the mixed-rate BTW block, so the BTW was derived from
  // the two printed anchors (excl + the paid total). The identity holds again — which means the
  // arithmetic gate above is now SILENT and nothing else would ever mention it. Say it out loud:
  // the total is still the invoice's, but this BTW is ours, and it is the voorbelasting the owner
  // will deduct. Always a human check, so a derived figure can never auto-book.
  if (fc?._btw_derived) {
    flags.arithmetic = true
    const used = fc._btw_derived.used
    reasons.push(
      typeof used === 'number'
        ? `de BTW-uitsplitsing was niet leesbaar — de BTW is afgeleid uit excl. en totaal (${formatEuro(used)}); controleer dit bedrag`
        : 'de BTW-uitsplitsing was niet leesbaar — de BTW is afgeleid uit excl. en totaal; controleer dit bedrag'
    )
  }

  // [EIGEN-CONTROLE-ONBEKEND] De controle die een EIGEN verkoopfactuur herkent kon niet draaien.
  // Geen oordeel over dit document — het is waarschijnlijk gewoon een inkoopfactuur — maar de ene
  // controle die de eigen factuur eruit haalt heeft niet geantwoord, en de stille afloop daarvan is
  // eigen omzet die als kost wordt geboekt met de BTW die je moet AFDRAGEN als voorbelasting
  // teruggevraagd. Zelfde register als [IBAN-CHECK-HONEST]: nooit beweren dat er iets gecontroleerd
  // is wat niet gecontroleerd kon worden.
  if (fc?._own_check_unavailable === true) {
    flags.vendor = true
    reasons.push(
      'we konden niet nagaan of dit je eigen verkoopfactuur is — controleer de leverancier vóór je dit als kost boekt'
    )
  }

  // [NUL-BTW-STIL] Er is € 0 BTW geboekt terwijl het document daar geen reden voor geeft: geen
  // 0 %-tarief, geen verlegging. De rekenkundige controle hierboven zwijgt hier per definitie —
  // het terugvalbedrag maakt excl. gelijk aan het totaal, dus de identiteit klopt — en zonder deze
  // zin staat er nergens iets over. Het is voorbelasting die de eigenaar anders nooit terugziet.
  // [VREEMDE-VALUTA] Niets aan de rekensom valt op: een dollarfactuur klopt intern perfect — in
  // dollars. Alleen deze zin zegt dat de bedragen op deze regel geen euro's zijn.
  // [ZELFFACTUUR] Geen enkel bedrag valt op: een zelffactuur telt precies zo op als elke andere.
  // Alleen deze zin vraagt de vraag die telt — is dit jouw verkoop of jouw inkoop?
  if (fc?._zelffactuur === true) {
    flags.vendor = true
    reasons.push(
      'op dit document staat dat de afnemer hem heeft opgemaakt (zelffacturering) — controleer of dit jouw eigen verkoop is en geen inkoop'
    )
  }

  if (typeof fc?._valuta?.code === 'string' && fc._valuta.code.length > 0) {
    flags.arithmetic = true
    reasons.push(
      `de bedragen op dit document staan in ${fc._valuta.code}, niet in euro's — vul zelf het eurobedrag in dat je bank heeft afgeschreven`
    )
  }

  if (fc?._btw_zero_unexplained === true) {
    flags.arithmetic = true
    reasons.push(
      'we lazen geen BTW op dit document en boekten € 0 voorbelasting — controleer of je BTW mag terugvragen'
    )
  }

  // [EX-INCL-FIX] The base is OUR subtraction (incl − btw), not the document's own figure — the
  // printed subtotal contradicted itself. Same rule as every derived figure: a human confirms it
  // before it books.
  if (fc?._ex_corrected) {
    flags.arithmetic = true
    const used = fc._ex_corrected.used
    reasons.push(
      typeof used === 'number'
        ? `het bedrag excl. BTW op de factuur was gelijk aan het totaal terwijl er BTW op staat — we hebben ${formatEuro(used)} afgeleid uit totaal min BTW; controleer dit bedrag`
        : 'het bedrag excl. BTW op de factuur sprak zichzelf tegen — we hebben het afgeleid uit totaal min BTW; controleer dit bedrag'
    )
  }

  // [ASSURANTIE] The document carries assurantiebelasting, not BTW. We removed it from the
  // deductible column (it is never voorbelasting) and folded it into the cost. Always a human
  // check: the amount is a real cost, but whether this document is a bookable cost at all — a
  // premium is usually paid on a separate nota — is a question only the owner can answer.
  if (fc?._assurantiebelasting) {
    flags.arithmetic = true
    const read = fc._assurantiebelasting.read
    reasons.push(
      typeof read === 'number'
        ? `dit is assurantiebelasting (${formatEuro(read)}), geen BTW — die mag je niet als voorbelasting aftrekken; we hebben hem uit de BTW gehaald, controleer dit`
        : 'dit is assurantiebelasting, geen BTW — die mag je niet als voorbelasting aftrekken; we hebben hem uit de BTW gehaald, controleer dit'
    )
  }

  // [BTW-SPLIT] The per-rate specification block, when the reader returned one, is the only thing
  // that can contradict a MIXED-RATE btw — the sum identity and the legal-rate test both go quiet
  // there (see btw-split.ts). So a block that does not reproduce our amounts has to be loud here:
  // this is the axis on which Enka Horeca 26701681 was booked € 0,46 short with every check green,
  // and voorbelasting is money the owner deducts. Flagging keeps it out of auto-advance, which
  // requires level === 'clean'.
  if (fc?._btw_rows && fc._btw_rows.length > 0) {
    const split = classifyBtwSplit({
      totalExBtw: inv.total_ex_btw,
      btwAmount: inv.btw_amount,
      rows: fc._btw_rows,
    })
    if (split.kind === 'blend-mismatch') {
      flags.arithmetic = true
      reasons.push(
        split.baseAgrees
          ? `de btw-specificatie op de factuur telt op tot ${formatEuro(split.rowsBtw)}, wij lazen ${formatEuro(inv.btw_amount ?? 0)} — controleer de btw`
          : `de btw-specificatie op de factuur (${formatEuro(split.rowsBase)} excl., ${formatEuro(split.rowsBtw)} btw) wijkt af van wat wij lazen — controleer de uitsplitsing`
      )
    }
  }

  // [PRINTED-TOTAL] The reader read "Totaal te voldoen" and then returned a DIFFERENT total. One of
  // its own two numbers is wrong and it could not tell which — which is precisely the state we now
  // ask it to report instead of quietly balancing. The printed figure is what the owner pays, so
  // this can never be waved through: it is held, with both numbers named.
  if (typeof fc?._total_printed === 'number') {
    flags.arithmetic = true
    reasons.push(
      `op de factuur staat ${formatEuro(fc._total_printed)} als te betalen totaal, wij lazen ${formatEuro(inv.total_inc_btw ?? 0)} — controleer welk bedrag klopt`
    )
  }

  // [PRINTED-TOTAL] Deliberately NOT a flag here: _total_derived (we computed one of the three
  // because the reader returned only two) is reported to the owner as a check that could not run
  // — invoice-checks.ts, the arithmetic row — and stops there. It is not evidence that anything is
  // wrong, and turning "we filled in the third figure" into "needs review" would add a demand for
  // human attention on a path whose frequency nobody has measured. A warning that cries wolf is
  // one the owner learns to tap past, and that costs more than it buys.

  // ── Money-truth axis (the amounts themselves) ────────────────────────────
  // [TRUST-AMOUNTS] The arithmetic gate above only runs its consistency checks
  // when incl > 0, so a MISSING or €0 total slips through as "clean" — a real
  // invoice the reader couldn't price would book as a €0 record with no warning.
  // The total is the money-truth; if it's absent or zero, that is never "clean" —
  // ask the human. (Legitimate €0 invoices effectively don't exist; a check costs
  // the owner one glance and prevents a silent €0 booking.)
  const incl = inv.total_inc_btw
  if (incl == null || Math.abs(incl) < 0.005) {
    flags.arithmetic = true
    reasons.push('het totaalbedrag ontbreekt of is € 0 — controleer de bedragen')
  }

  // [TRUST-AMOUNTS] The amounts' own confidence, when the reader provided it. A
  // low score means the reader itself was unsure about the money — surface that
  // loudly instead of presenting a confident-looking total. We under-claim: only
  // flag when a score is actually present and low (never fabricate doubt).
  //
  // [E-FACTUUR-BESLECHT] Behalve wanneer de leverancier het bedrag zelf heeft meegestuurd en dat
  // klopt met wat er is gelezen. Dan is "de lezer was onzeker" een uitspraak over een lezing die
  // niet meer het bewijs is: het bedrag staat in machinevorm in hetzelfde bestand, tot op de cent
  // gelijk. De ondernemer waarschuwen dat een getal onzeker gelezen is terwijl de leverancier het
  // zwart op wit heeft meegeleverd, is hem laten controleren wat de app al zeker weet — en dat is
  // precies hoe een waarschuwing haar betekenis verliest.
  //
  // Alleen deze as. Een e-factuur zegt niets over of dit een aanmaning, een overzicht of een
  // creditnota is, dus alles daarover blijft staan. Zie eInvoiceSettlesAmounts().
  if (fc && !eInvoiceSettlesAmounts(fc)) {
    const amountScores = [fc.amount, fc.total, fc.total_inc_btw].filter(
      (n): n is number => typeof n === 'number'
    )
    if (amountScores.length > 0 && Math.min(...amountScores) < LOW_CONFIDENCE) {
      flags.arithmetic = true
      reasons.push('het bedrag is onzeker gelezen — controleer de bedragen')
    }
  }

  // ── Date axis ────────────────────────────────────────────────────────────
  // [TRUST-DATE] A MISSING invoice date is not "clean": the server confirm route
  // hard-blocks a dateless invoice (the DATE-GATE), so a green "klaar" pill would
  // lie — the owner taps confirm and it fails. Flag it here so the pill and the
  // server agree, and the owner is told to add the date up front.
  if (!inv.invoice_date || !String(inv.invoice_date).trim()) {
    flags.invoiceDate = true
    reasons.push('de factuurdatum ontbreekt — vul hem aan om te kunnen bevestigen')
  }

  // ── Invoice-number axis (the value, not just the AI's confidence) ────────
  // [TRUST-NUMBER] A missing/placeholder number is never "clean": the stored
  // EMAIL-<ts> placeholder is a fabricated identifier (defeats duplicate detection
  // and is not a real Art. 35 number). Only evaluate when the caller supplied the
  // field, so legacy call sites that don't pass it keep their old behaviour.
  // [BON-NUMMER] Een KASSABON is hiervan uitgezonderd — zie isKassabon().
  if (inv.invoice_number !== undefined && !isKassabon(fc)) {
    const num = inv.invoice_number
    if (!num || !String(num).trim() || isPlaceholderInvoiceNumber(num)) {
      flags.invoiceNumber = true
      reasons.push('het factuurnummer ontbreekt of kon niet worden gelezen — controleer het')
    }
  }

  // ── Confidence axis ──────────────────────────────────────────────────────
  // The AI told us which fields it was unsure about. Mirror the modal's logic:
  // a missing score defaults to confident (1) so we never false-flag clean rows.
  if (fc) {
    // [EEN-VELD-EEN-ZIN] One field, one sentence — as a RULE, not per field.
    //
    // Two axes describe the same three fields. The VALUE axis is a fact about what was stored
    // ("ontbreekt", "staat nergens in de tekst"); the CONFIDENCE axis is the reader's opinion of
    // it ("is onzeker"). When both fire, the card printed two rows about one field with exactly
    // the same action behind them.
    //
    // This was fixed for the invoice number alone, on a Univé invoice that showed four warnings
    // where there were three things wrong. That was a special case where a rule belonged: the
    // supplier and the date had the identical shape and kept both sentences. A list that pads
    // itself teaches the owner to skim, and the row that matters is then skimmed with the rest.
    //
    // The value axis wins because it says more. The FLAG is set either way, so the field is
    // pointed at exactly as hard as before — only the weaker second sentence goes. Suppressing
    // the flag instead would hide the field, which is the opposite of the intent.
    const softer = (already: boolean, sentence: string) => { if (!already) reasons.push(sentence) }

    if ((fc.vendor ?? 1) < LOW_CONFIDENCE) {
      softer(flags.vendor, 'de leverancier is onzeker')
      flags.vendor = true
    }
    if ((fc.invoice_number ?? 1) < LOW_CONFIDENCE && !isKassabon(fc)) {
      softer(flags.invoiceNumber, 'het factuurnummer is onzeker')
      flags.invoiceNumber = true
    }
    if ((fc.invoice_date ?? 1) < LOW_CONFIDENCE) {
      softer(flags.invoiceDate, 'de factuurdatum is onzeker')
      flags.invoiceDate = true
    }
  }

  // ── [CREDIT-PREFIX-GATE] Credit-note axis ────────────────────────────────
  // The ONE deterministic credit check available at import time. Every other one in this codebase
  // asks the model (is_credit_note, document_kind) — and CREDITFACTUUR CR0301267, which prints its
  // total as € -33,87, came back is_credit_note=false with a breakdown that reconciles to the cent.
  // It was 'clean' on every axis above, so it auto-advanced: booked as a € 33,87 debt, its btw
  // added to the reclaim instead of subtracted, with no human in the loop to notice.
  //
  // This does not decide that it IS a credit note — the number is evidence, not proof, and the sign
  // stays the owner's to declare. It decides that nobody may be skipped while the question is open.
  if (looksLikeCreditnotaByNumber({
    invoiceNumber: inv.invoice_number,
    totalIncBtw: inv.total_inc_btw,
    invoiceType: inv.invoice_type,
  })) {
    flags.creditPrefix = true
    reasons.push(
      `het nummer begint met ${numberPrefix(inv.invoice_number)} — controleer of dit een creditnota is; ` +
      'die hoort met een minbedrag in de boeken'
    )
  }

  // [CREDIT-WOORD] Tweede greep op dezelfde fout, en de enige die ook werkt als de leverancier zijn
  // creditnota's in de gewone nummerreeks zet — dan zegt het nummer niets en de kop alles. Zelfde
  // voorwaarden als hierboven: alleen zolang de rij nog als schuld staat, want een rij die al
  // negatief of al 'creditnota' is, heeft de vraag beantwoord.
  if (storedSafecore?.credit_word_in_header === true &&
      inv.invoice_type !== 'creditnota' &&
      !(Number(inv.total_inc_btw ?? 0) < 0)) {
    flags.creditPrefix = true
    reasons.push(
      'in de kop van dit document staat het woord "creditnota" — controleer of dat klopt; ' +
      'die hoort met een minbedrag in de boeken'
    )
  }

  const level: HealthLevel =
    flags.arithmetic || flags.vendor || flags.invoiceNumber || flags.invoiceDate || flags.reminder || flags.possibleDuplicate || flags.ibanChanged || flags.multipleInvoices || flags.creditPrefix
      ? 'needs-review'
      : 'clean'

  return { level, reasons, flags, ...(alternativeTotals ? { alternativeTotals } : {}) }
}