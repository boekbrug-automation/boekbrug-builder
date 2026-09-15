// src/lib/aangifte.ts
// [AANGIFTE] Pure mapper: the reconciled financial result -> a CONCEPT BTW-aangifte in
// the exact Belastingdienst rubriek layout (1a/1b/1c/1e, 5a/5b/5g). No I/O, fully
// testable (run: npx tsx src/lib/aangifte.test.ts) — and its test is pinned to a REAL
// accountant filing (Kiwi Food Market, Q1 2026) so the mapping provably reproduces the
// actual form.
//
// THREE HARD RULES (the owner's, honoured literally):
//   1. Every number is DERIVED from data the owner already imported — nothing invented.
//   2. It is a CONCEPT, never a filing. Amounts are only as complete as the uploads, and
//      the notes say exactly what each figure depends on — no false reassurance.
//   3. Whole euros, and 5a is the SUM of the rounded rubrieken (as the Belastingdienst
//      form computes it), so our concept reconciles line-for-line with the accountant's.

import { VERLEGD_DEFAULT_RATE } from "./verlegde-btw";
import type { FinancialResult } from "./financial-result";
import { telWoord, woordBij, vervoeg } from "./nl-plural";

/** Only the parts of the result the aangifte needs. */
export type AangifteInput = Pick<
  FinancialResult,
  "salesByRate" | "btwVoorbelasting" | "cashOmzetZonderBtw"
> & {
  // [ICP] Turnover supplied to businesses in other EU member states (ex BTW), read from the
  // customers' VAT numbers — it belongs in rubriek 3b, not in 1e. Not part of FinancialResult
  // because no RATE distinguishes it: 0% is 0% until you look at who the customer is. Both
  // rubrieken carry €0 BTW, so stating it correctly can never move 5a, 5b or 5g.
  intraEuOmzet?: number;
  // [VRIJGESTELD] Turnover exempt under art. 11 Wet OB. It reaches NO rubriek — not even 1e,
  // which is for 0%-taxed and reverse-charged supplies, not for an exemption — so it arrives
  // here only to be NAMED in the notes. Exactly the treatment cashOmzetZonderBtw gets: a figure
  // the owner can see and reconcile against their own books, never a silent omission.
  vrijgesteldeOmzet?: number;
  // The pro-rata percentage applied to input BTW on costs serving both activities, or null when
  // the regime is off or the ratio was undecidable.
  proRataPercent?: number | null;
  // Input BTW on mixed costs left OUT of 5b because no ratio could be determined. > 0 ⇒ 5b is
  // deliberately too low, and the note says so.
  voorbelastingUnresolved?: number;
  // [TEGENTEKEN] Input BTW left out of 5b because the document's base and its BTW carry opposite
  // signs. A magnitude, not a signed amount: which direction it belongs in is exactly what such a
  // row fails to say. > 0 ⇒ 5b is deliberately too low and the note names the figure.
  voorbelastingTegenteken?: number;
  // Input BTW on costs attributed wholly to exempt activity — never deductible. Shown so an
  // owner who expected a refund can see what it went to.
  voorbelastingGeblokkeerd?: number;
  // Turnover from sources this feature cannot classify (till Z-report, rated cash sales) and
  // therefore booked as TAXED. Named in the notes rather than left for the owner to find.
  onclassificeerbareOmzet?: number;
  // Whether the exempt regime applied at all — see the field of the same name on FinancialResult.
  exemptRegime?: boolean;
  // [VERLEGD-NAAR-MIJ] Purchases whose supplier shifted the BTW to this owner (art. 12 lid 5 Wet
  // OB). Not part of FinancialResult because it changes nothing there: the invoice carries no BTW,
  // so it is a plain cost. It changes the AANGIFTE on two lines at once — owed in 2a, deducted in
  // 5b — and those two must be the same number or they stop cancelling. See verlegde-btw.ts.
  // [VERLEGD-AFTREK] `aftrekbaar` is what of that BTW the owner may deduct: equal to `btw` for a
  // full right of deduction (absent means exactly that), less under the exempt regime, and the
  // caller's business to compute because only it knows the regime. See totaalVerlegd.
  verlegdNaarMij?: { grondslag: number; btw: number; aantal: number; aftrekbaar?: number } | null;
  // [KOR] The owner has declared the kleineondernemersregeling. Under it there is no right of
  // deduction at all (art. 25 Wet OB), so verlegde BTW is owed in 2a and nothing of it returns in
  // 5b — whatever share the caller computed.
  korActive?: boolean;
  // [BUITENLANDSE-INKOOP] Purchases from abroad whose btw is shifted to this owner: rubriek 4a
  // (a supplier outside the EU) and 4b (another member state). The same shape and the same rule as
  // 2a — owed in the rubriek, the deductible share back in 5b, nothing back under the KOR. Absent
  // (undefined) means the caller does not compute them; null means it did and found nothing.
  // See foreign-purchase-vat.ts.
  verlegdBuitenEu?: { grondslag: number; btw: number; aantal: number; aftrekbaar?: number } | null;
  verlegdBinnenEu?: { grondslag: number; btw: number; aantal: number; aftrekbaar?: number } | null;
};

export interface AangifteCompleteness {
  turnoverDays: number;          // days of dagomzet imported for the period
  quarterDays: number;           // calendar days in the quarter
  incomingInvoiceCount: number;  // purchase invoices feeding 5b (voorbelasting)
  outgoingInvoiceCount: number;  // sales invoices feeding 1a/1b
  // An incoming invoice with an EU btw-nummer. Only a caller that does NOT compute 4b (verlegdBinnenEu
  // left undefined) gets the bare sentence below; the route and the package compute it.
  hasEuPurchase: boolean;
  // [ICP] The richer version of the line above: the EU purchases NAMED, built by
  // foreignPurchaseNote(). When present it replaces the bare "there are EU purchases" sentence.
  euPurchaseNote?: string | null;
  // Verified invoices with NO invoice_date. A date-range fetch silently drops them, so they
  // are NOT in the figures above — surfaced as a note so the concept isn't quietly too low.
  datelessVerifiedCount?: number;
  // [COUNT-BASIS] Which set the counts above describe. Under kasstelsel the OMZET rubrieken are
  // built from SETTLEMENTS (money that came in this quarter), not from the invoices DATED in it
  // — two genuinely different sets, on purpose: a sales invoice from last year paid in March
  // belongs in this quarter, and one issued in March but unpaid does not. So outgoingInvoiceCount
  // is the settled set under kas.
  // [KAS-VOORBELASTING] incomingInvoiceCount is NOT: 5b is dated by the purchase invoice on both
  // schemes, so it counts the purchase invoices of this quarter either way.
  // Absent → 'factuur' (the accrual wording, unchanged).
  scheme?: "factuur" | "kas";
}

export interface AangifteRow {
  code: "1a" | "1b" | "1c" | "1e" | "2a" | "3b" | "4a" | "4b";
  label: string;
  omzet: number;                 // whole euros
  btw: number;                   // whole euros (0 for 1e)
}

export interface ConceptAangifte {
  quarterLabel: string;
  rows: AangifteRow[];
  verschuldigd: number;          // 5a — sum of the rounded rubriek BTW
  voorbelasting: number;         // 5b
  saldo: number;                 // 5g — te betalen (>0) of terug te ontvangen (<0)
  cashOmzetZonderBtw: number;    // omzet without a known rate — deliberately NOT in any rubriek
  // [VRIJGESTELD] Exempt turnover — likewise NOT in any rubriek, and for a stronger reason: an
  // exemption is not a rate, so there is no box on the form it belongs in. 0 off-regime.
  vrijgesteldeOmzet: number;
  notes: string[];               // honest limits — what each figure depends on
  // [KOR-AANGIFTE-UIT] The owner is in the kleineondernemersregeling: the sales rubrieken and 5b
  // are switched off (see buildAangifte), and the screen shows a panel instead of a table.
  korActive: boolean;
  isConcept: true;
}

/**
 * Whole euros, the way the Belastingdienst rounds — and SYMMETRICALLY around zero.
 *
 * ── WHY NOT Math.round ──
 * Math.round breaks ties toward +∞, not away from zero. So `Math.round(1.5)` is 2 while
 * `Math.round(-1.5)` is −1: the same half-euro rounds up in one direction and down in the other.
 *
 * On a normal quarter that is invisible, because every rubriek is positive. It stops being
 * invisible on a quarter that nets NEGATIVE — a business that issued a large creditnota, a
 * refunded season, a corrected invoice from an earlier period. Those are exactly the quarters
 * where a figure is already unusual and least likely to be double-checked, and there the bias runs
 * one way every time: consistently toward zero, which on a reclaim is consistently against the
 * owner.
 *
 * The amount is at most €1 per rubriek, and it is still worth fixing for a reason that has nothing
 * to do with the euro: this figure is copied into an aangifte. A number that cannot be reproduced
 * by the person checking it — because their calculator rounds −1,50 to −2 and ours said −1 — costs
 * far more in trust than it ever could in tax.
 *
 * `-0` is normalised to `0`: JavaScript keeps them distinct, and a rubriek printed as "−0" on a
 * concept an accountant reads is a question nobody should have to ask.
 *
 * EXPORTED because the filed snapshot is shown next to these figures and must be rounded by the
 * same rule. It was rounded with Math.round, which is the asymmetry above — on a quarter that nets
 * negative the two numbers on one screen disagreed about the same half-euro.
 */
export const euro = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  const rounded = Math.sign(n) * Math.round(Math.abs(n));
  return rounded === 0 ? 0 : rounded;
};

/**
 * [SUPPLETIE-FANTOOM] Het 5g-saldo van een INGEDIENDE momentopname, gerekend zoals 5g gedefinieerd
 * is: 5a min 5b, elk afzonderlijk afgerond. Eén regel, twee lezers — /api/aangifte toont hem naast
 * 5a en 5b, /api/btw-reservation telt hem op bij het bedrag dat opzij moet.
 *
 * Beide deden het anders, en allebei fout op hun eigen manier:
 *
 *   · btw-reservation rondde het RUWE verschil in één keer af (Math.round), terwijl de ongediende
 *     tak van diezelfde route buildAangifte aanroept en dus 5a−5b krijgt. Op verschuldigd
 *     € 1000,60 en voorbelasting € 200,40 reserveerde het scherm € 800 voor een aangifte die de
 *     eigenaar zojuist voor € 801 had ingediend.
 *   · /api/aangifte toonde 5a = euro(1000,60) = 1001 en 5b = euro(200,40) = 200 naast een 5g van
 *     euro(800,20) = 800. Drie getallen op één paneel waarvan er twee de derde tegenspreken.
 *
 * WAT DIT NIET REPAREERT: de momentopname bewaart alleen de totalen, niet de rubrieken. Het concept
 * telt per tarief afgerond op; dit rondt hun som af. Bij één tarief — het gewone geval, en het
 * geval hierboven — is dat hetzelfde getal. Bij meerdere tarieven kan er één euro overblijven, en
 * die is pas weg als de momentopname de rubrieken zelf bewaart. Dat is een migratie.
 */
export function filedSaldo(filed: {
  btw_saldo?: number | null;
  btw_verschuldigd?: number | null;
  btw_voorbelasting?: number | null;
}): number {
  const v = filed.btw_verschuldigd;
  const vb = filed.btw_voorbelasting;
  // Een oudere rij kan de twee componenten missen; dan is het ruwe saldo het beste dat er is.
  if (v == null || vb == null) return euro(Number(filed.btw_saldo) || 0);
  return euro(Number(v) || 0) - euro(Number(vb) || 0);
}

const RATE_LABEL: Record<string, string> = {
  "1a": "Leveringen/diensten belast met hoog tarief (21%)",
  "2a": "Leveringen/diensten waarbij de omzetbelasting naar u is verlegd",
  "1b": "Leveringen/diensten belast met laag tarief (9%)",
  "1c": "Leveringen/diensten belast met overige tarieven, behalve 0%",
  "1e": "Leveringen/diensten belast met 0% of niet bij u belast",
  "3b": "Leveringen naar landen binnen de EU",
  "4a": "Leveringen/diensten uit landen buiten de EU",
  "4b": "Leveringen/diensten uit landen binnen de EU",
};

/** The order of the paper form, whatever order the rows were found in. */
const RUBRIEK_ORDER = ["1a", "1b", "1c", "1e", "2a", "3b", "4a", "4b"];

/**
 * Map the reconciled result into a concept aangifte. 21% -> 1a, 9% -> 1b, 0% -> 1e, any
 * other non-zero rate -> 1c (aggregated). 5a is the sum of the rounded rubriek BTW so it
 * ties to the paper form; 5b is the documented voorbelasting; 5g = 5a - 5b.
 */
export function buildAangifte(
  input: AangifteInput,
  completeness: AangifteCompleteness,
  quarterLabel: string,
  // [REGIME-FLAGS] Optional accountant-handoff notes (KOR / BTW verlegd / margeregeling) —
  // regimes this concept does NOT auto-compute. Appended to the notes so the concept the
  // owner sees and the ZIP hands over is honest about what the accountant must still handle.
  regimeNotes?: string[],
): ConceptAangifte {
  let btw1a = 0, om1a = 0, btw1b = 0, om1b = 0, btw1c = 0, om1c = 0, om1e = 0;
  for (const s of input.salesByRate) {
    if (s.rate === 21) { om1a += s.omzet; btw1a += s.btw; }
    else if (s.rate === 9) { om1b += s.omzet; btw1b += s.btw; }
    else if (s.rate === 0 && Math.round(s.btw) === 0) { om1e += s.omzet; } // genuine 0%
    // Any other rate — OR a rate-0 bucket that carries BTW (an undecidable/mis-derived
    // rate, e.g. a null-field or blended-rate invoice) — goes to 1c so the BTW stays
    // VISIBLE and 5a reflects it, never silently zeroed into 1e.
    else { om1c += s.omzet; btw1c += s.btw; }
  }

  // [KOR-AANGIFTE-UIT] Under the KOR the owner files no btw return: no btw on sales and no right of
  // deduction (art. 25 Wet OB). So the sales rubrieken are switched off — the way Moneybird and
  // Exact switch the whole return off — with the two exceptions the law keeps: btw that IS stated
  // on a sales invoice is owed whatever the regime (art. 37 Wet OB), and btw shifted TO the owner
  // (2a, 4a, 4b) is owed and must be declared. Everything else stays empty on purpose, and the
  // notes say so. Before this, a KOR owner read a full table with a note underneath saying the
  // figures did not apply — a return that contradicts itself on the screen it is filed from.
  const kor = input.korActive === true;
  const rows: AangifteRow[] = [];
  const sales = (code: "1a" | "1b" | "1c", om: number, btw: number, always: boolean): void => {
    const o = euro(om), b = euro(btw);
    // Off the KOR: 1a and 1b always (the form has them), 1c only when it holds something.
    // Under the KOR: only a row whose btw was actually stated on an invoice (art. 37).
    if (kor ? b !== 0 : always || o !== 0 || b !== 0) rows.push({ code, label: RATE_LABEL[code], omzet: o, btw: b });
  };
  sales("1a", om1a, btw1a, true);
  sales("1b", om1b, btw1b, true);
  sales("1c", om1c, btw1c, false);
  // [ICP] Intra-EU supplies are 0%-turnover that the rate alone cannot distinguish, so they land
  // in the 1e bucket above. Move them to 3b, where the Belastingdienst cross-checks them against
  // the ICP-opgaaf. Capped at what 1e actually holds: 1e can never go negative, and turnover that
  // is not there is not invented. Both rubrieken carry €0 BTW, which is the whole safety of this
  // step — 5a, and therefore 5g, is identical with or without it.
  //
  // It moves in EITHER direction. A quarter whose EU turnover nets negative — a creditnota for a
  // sale invoiced earlier — has a genuinely negative 3b, and clamping that to zero would leave
  // the credit sitting in 1e while the ICP-opgaaf beside it reports the negative. The two are
  // handed to the same accountant; they may not contradict each other.
  // euro(), not Math.round: this file's own header says why, and a net-negative EU quarter is
  // where the two differ (Math.round(-1.5) is -1, euro(-1.5) is -2 — the 1e bucket it must match
  // is rounded with euro, so the two would disagree about the same credit note).
  const intraEu = euro(input.intraEuOmzet ?? 0);
  // [KOR-AANGIFTE-UIT] Under the KOR, 0%-turnover is exempt turnover: no box on a return that is
  // not filed. 1e and 3b therefore stay empty; the ICP block beside the concept is the route's.
  const e1 = kor ? 0 : euro(om1e);
  // Only ever move what 1e actually holds, in the direction it holds it. Mixed signs (positive
  // EU turnover against a negative 0%-bucket, or the reverse) move nothing: there is no honest
  // amount to shift, and the note still names the ICP lines.
  const om3b =
    intraEu > 0 && e1 > 0 ? Math.min(intraEu, e1)
    : intraEu < 0 && e1 < 0 ? Math.max(intraEu, e1)
    : 0;
  const rest1e = e1 - om3b;
  if (rest1e !== 0) rows.push({ code: "1e", label: RATE_LABEL["1e"], omzet: rest1e, btw: 0 });
  if (om3b !== 0) rows.push({ code: "3b", label: RATE_LABEL["3b"], omzet: om3b, btw: 0 });

  // [VERLEGD-NAAR-MIJ] Rubriek 2a — BTW die een leverancier naar deze eigenaar heeft verlegd.
  //
  // Twee dingen in dezelfde aangifte, en de volgorde waarin ze hier staan is de volgorde op het
  // formulier: 2a telt mee in het VERSCHULDIGDE (5a), en exact hetzelfde bedrag mag eraf in de
  // voorbelasting (5b). Bij volledige aftrek vallen ze tegen elkaar weg en betaalt de eigenaar
  // niets — en juist dáárom lijkt weglaten onschuldig. Dat is het niet: de aangifte is dan op twee
  // regels onjuist, hij sluit niet aan op de aangifte van de onderaannemer, en de Belastingdienst
  // legt die twee naast elkaar. Voor een deels vrijgestelde eigenaar vallen ze niet eens weg.
  //
  // Hetzelfde afgeronde bedrag aan beide kanten, uit één berekening. Twee keer los afronden is hoe
  // twee bedragen die moeten wegvallen een saldo van een paar cent achterlaten op een aangifte
  // waar niets te betalen viel.
  const verlegd = input.verlegdNaarMij ?? null;
  const verlegdBtw = verlegd ? euro(verlegd.btw) : 0;
  if (verlegd && (verlegd.grondslag !== 0 || verlegdBtw !== 0)) {
    rows.push({ code: "2a", label: RATE_LABEL["2a"], omzet: euro(verlegd.grondslag), btw: verlegdBtw });
  }

  // [BUITENLANDSE-INKOOP] 4a and 4b, exactly the way 2a is handled: one rounded figure per rubriek
  // on the owed side, and the deductible share — never more than the rubriek, nothing under the
  // KOR — back in 5b. A zzp'er's Adobe, AWS and UK invoices all live here; before this the return
  // was silent on two lines and, under the KOR, short by the whole amount.
  const buitenlands = (v: { grondslag: number; btw: number; aantal: number; aftrekbaar?: number } | null | undefined) => {
    if (!v) return { btw: 0, aftrek: 0 };
    const btw = euro(v.btw);
    const aftrek = input.korActive ? 0 : euro(typeof v.aftrekbaar === "number" ? v.aftrekbaar : v.btw);
    return { btw, aftrek };
  };
  const v4a = buitenlands(input.verlegdBuitenEu);
  const v4b = buitenlands(input.verlegdBinnenEu);
  if (input.verlegdBuitenEu && (input.verlegdBuitenEu.grondslag !== 0 || v4a.btw !== 0)) {
    rows.push({ code: "4a", label: RATE_LABEL["4a"], omzet: euro(input.verlegdBuitenEu.grondslag), btw: v4a.btw });
  }
  if (input.verlegdBinnenEu && (input.verlegdBinnenEu.grondslag !== 0 || v4b.btw !== 0)) {
    rows.push({ code: "4b", label: RATE_LABEL["4b"], omzet: euro(input.verlegdBinnenEu.grondslag), btw: v4b.btw });
  }
  // The form's order, whatever order the rows were found in — 2a between 1e and 3b, 4a/4b last.
  rows.sort((a, b) => RUBRIEK_ORDER.indexOf(a.code) - RUBRIEK_ORDER.indexOf(b.code));

  const verschuldigd = rows.reduce((s, r) => s + r.btw, 0); // 5a — sum of rounded rubrieken
  // 5b = de gedocumenteerde voorbelasting PLUS het AFTREKBARE deel van de verlegde BTW uit 2a.
  //
  // [VERLEGD-AFTREK] What of 2a returns in 5b follows the owner's RIGHT of deduction, not the
  // rubriek. With a full right — every owner without a regime — it is the same rounded number as
  // 2a and the two cancel, which is the case the comment above describes. Under the KOR there is
  // no right of deduction at all (art. 25 Wet OB): 2a is owed and nothing comes back. Under the
  // exempt regime each verlegde purchase follows the owner's attribution and the pro-rata
  // percentage, exactly like the ordinary voorbelasting does in financial-result. Before this, 5b
  // took the whole 2a amount for everyone: a partly exempt owner (pro rata 20%) with EUR 10.000 of
  // subcontracting deducted EUR 2.100 where EUR 420 was allowed — EUR 1.680 understated on a
  // return they sign, and the note beside it said "per saldo betaal je er niets over".
  const verlegdAftrek = !verlegd || input.korActive
    ? 0
    : euro(typeof verlegd.aftrekbaar === "number" ? verlegd.aftrekbaar : verlegd.btw);
  // [KOR-AANGIFTE-UIT] No right of deduction at all under the KOR: the documented voorbelasting is
  // a cost, never a claim. verlegdAftrek and the 4a/4b shares are already 0 under the KOR.
  const gedocumenteerd = kor ? 0 : euro(input.btwVoorbelasting);
  const voorbelasting = gedocumenteerd + verlegdAftrek + v4a.aftrek + v4b.aftrek;
  const saldo = verschuldigd - voorbelasting;                // 5g

  // ── Honest notes — no false reassurance. Every figure states what it depends on. ──
  const notes: string[] = [];
  notes.push("Dit is een CONCEPT op basis van je ingevoerde gegevens — geen ingediende aangifte. Je boekhouder controleert en dient in.");
  // [COUNT-BASIS] Under kas the counts describe invoices that were PAID in this quarter, so they
  // are named that way. The old wording ("ingevoerde inkoopfacturen") counted the invoices dated
  // in the quarter while 5a/5b were built from the settlements — a number that could be off by
  // any amount in either direction, printed in the block this page calls its trust layer.
  const onCash = completeness.scheme === "kas";
  if (kor) {
    // [KOR-AANGIFTE-UIT] What this concept is under the KOR, in the words the owner needs: no
    // return, and the two things that are owed anyway. Never "nog geen omzet ingevoerd" — the
    // sales rubrieken are empty by design, not by omission.
    notes.push(
      "KOR actief: je doet geen btw-aangifte. Onder de KOR reken je geen btw en heb je geen recht op aftrek " +
      "(art. 25 Wet OB), dus dit concept toont geen omzetrubrieken en geen voorbelasting.",
    );
    const gesteld = rows.filter((r) => r.code === "1a" || r.code === "1b" || r.code === "1c");
    if (gesteld.length > 0) {
      const btwGesteld = gesteld.reduce((sum, r) => sum + r.btw, 0);
      notes.push(
        `Op verkoopfacturen van dit kwartaal staat wél btw (€${btwGesteld.toLocaleString("nl-NL")}). Btw die op een factuur ` +
        "staat is verschuldigd, ook onder de KOR (art. 37 Wet OB). Was dat niet de bedoeling, corrigeer dan met een creditnota.",
      );
    }
    if (rows.some((r) => r.code === "2a" || r.code === "4a" || r.code === "4b")) {
      notes.push(
        "Btw die naar jou is verlegd (2a, 4a, 4b) blijft onder de KOR verschuldigd. Krijg je voor dit tijdvak geen " +
        "aangifte, vraag die dan aan bij de Belastingdienst en geef deze rubrieken aan.",
      );
    }
    if (rows.length === 0) notes.push("Er is dit kwartaal niets aan te geven.");
  } else {
    notes.push(
      `Verkoop-BTW (5a) is berekend uit ${telWoord(completeness.turnoverDays, "dag", "dagen")} dagomzet` +
      `${completeness.outgoingInvoiceCount
        ? ` en ${completeness.outgoingInvoiceCount} ${onCash ? "in dit kwartaal betaalde " : ""}${woordBij(completeness.outgoingInvoiceCount, "verkoopfactuur")}`
        : ""}.`,
    );
    if (completeness.turnoverDays > 0 && completeness.turnoverDays < completeness.quarterDays) {
      notes.push(
        `Let op: dit kwartaal heeft ${completeness.quarterDays} dagen, maar er zijn ${completeness.turnoverDays} kassadagen geïmporteerd. ` +
        "Ontbrekende dagen tellen NIET mee — controleer of alle Z-rapporten erin zitten.",
      );
    }
    // [VRIJGESTELD] The exempt figure counts as turnover HERE too. Without it this sentence tells a
    // fully exempt owner — a dentist with EUR 132.000 of care turnover, correctly in no rubriek —
    // that they have "nog geen omzet ingevoerd", which is both false and the opposite of reassuring:
    // it reads as "your quarter is empty" at the moment their data is complete.
    if (completeness.turnoverDays === 0 && input.salesByRate.length === 0 && !(input.vrijgesteldeOmzet ?? 0)) {
      notes.push("Er is nog geen omzet ingevoerd — 5a is leeg tot je dagomzet of verkoopfacturen toevoegt.");
    }
    // [KAS-VOORBELASTING] One sentence for both schemes: 5b counts the purchase invoices of this
    // quarter, paid or not. The kasstelsel moves the btw you OWE to the payment date and leaves the
    // deduction on the invoice date, so the sentence that said "die je hebt BETAALD" described a
    // rule the Belastingdienst does not have.
    notes.push(
      `Voorbelasting (5b) telt alleen ${telWoord(completeness.incomingInvoiceCount, "ingevoerde inkoopfactuur")}. ` +
        "Ontbreekt er een inkoopfactuur, dan is de voorbelasting te laag en het te betalen bedrag te hoog.",
    );
    if (onCash) {
      notes.push(
        "Onder het kasstelsel verschuift alleen de BTW over je omzet naar de betaaldatum. " +
          "De voorbelasting trek je af in het kwartaal van de inkoopfactuur, ook als je die nog niet betaald hebt.",
      );
    }
    if (input.cashOmzetZonderBtw > 0) {
      notes.push(
        `€${euro(input.cashOmzetZonderBtw)} omzet heeft nog geen BTW-tarief (contante omzet, bankomzet of een niet-gesplitste kassadag) — die is NIET in 1a/1b ingedeeld. ` +
        "Ken een tarief toe voor een compleet beeld.",
      );
    }
  }
  // [RUBRIEK-1E] What is in 1e, and what the app cannot take out of it.
  //
  // The form has three boxes for turnover that carries no Dutch BTW, and they are not
  // interchangeable:
  //   1e  0%-omzet en verlegde omzet — BINNENLANDS
  //   3a  leveringen naar landen BUITEN de EU (uitvoer)
  //   3c  installatie- en afstandsverkopen BINNEN de EU
  //
  // This concept can emit 1a, 1b, 1c, 1e, 2a, 3b, 4a and 4b, and no others. Everything taxed at 0% that is not
  // recognised as intra-EU therefore lands in 1e — including an export to a customer in the UK,
  // Switzerland or the United States, which belongs in 3a. The TOTAL is right either way (all
  // three boxes carry EUR 0 of BTW, so 5a and 5g do not move by a cent), and the FILED RETURN is
  // still wrong: it states domestic 0%/verlegde omzet where there was an export.
  //
  // Why this is a note and not a computation: 3a and 3c are decided by where the customer is AND
  // what kind of supply it was (goods leaving the EU, an installation, a distance sale). The
  // customer's country exists since [KLANT-LAND]; the kind of supply does not, and half an answer
  // printed as a rubriek is a guess printed on a tax return. So the split is not built yet, and the
  // note says exactly that.
  //
  // So the accountant is told exactly what 1e holds and what to look for, and the number is left
  // alone. That is the same shape as the [ICP] block above, which only ever MOVES turnover it can
  // account for and never invents any.
  const bedrag1e = rows.find((r) => r.code === "1e")?.omzet ?? 0;
  if (bedrag1e !== 0) {
    notes.push(
      `€${bedrag1e.toLocaleString("nl-NL")} staat in rubriek 1e. Daar zet deze app ALLE 0%-omzet in die ` +
      "niet als levering binnen de EU herkend is. Verkocht je aan een klant BUITEN de EU, dan hoort " +
      "die omzet in 3a (uitvoer), en installatie- of afstandsverkopen binnen de EU horen in 3c. " +
      "Rubriek 3a en 3c rekent dit concept nog niet uit, ook als het land van je klant is vastgelegd — het " +
      "bedrag en de te betalen BTW veranderen er niet door, de rubriek wel. Laat je boekhouder dit " +
      "controleren als je buiten Nederland hebt geleverd.",
    );
  }

  // [VRIJGESTELD] Exempt turnover, and what it costs on the deduction side. Four separate
  // sentences because they are four separate facts, and an owner who reads only the first one
  // must not be left with a wrong impression of the other three — the same discipline the KOR
  // note follows, where "the afdracht lapses" without "and so does the aftrek" was the trap.
  const vrijgesteld = euro(input.vrijgesteldeOmzet ?? 0);
  if (vrijgesteld !== 0) {
    notes.push(
      `€${vrijgesteld.toLocaleString("nl-NL")} van je omzet is VRIJGESTELD (art. 11 Wet OB) en staat daarom in GEEN ` +
      "enkele rubriek — ook niet in 1e, want dat vak is voor 0%-omzet en verlegde omzet, niet voor een " +
      "vrijstelling. Die omzet telt wel gewoon mee in je resultaat en in je inkomstenbelasting.",
    );
    if (typeof input.proRataPercent === "number") {
      notes.push(
        `Omdat je zowel belaste als vrijgestelde omzet hebt, is de BTW op kosten die BEIDE dienen voor ` +
        `${input.proRataPercent}% afgetrokken (pro rata: belaste omzet ÷ totale omzet, naar boven afgerond). ` +
        "Kosten die je aan één kant hebt toegewezen volgen die toewijzing, niet dit percentage. " +
        "Je boekhouder toetst of de omzetverhouding hier de juiste maatstaf is — bij een sterk afwijkend " +
        "werkelijk gebruik mag of moet daarvan worden afgeweken, en voor investeringsgoederen geldt " +
        "bovendien een herzieningstermijn die dit concept niet bijhoudt.",
      );
    }
  }
  // [VRIJGESTELD] Deliberately OUTSIDE the `vrijgesteld !== 0` block above, where it used to sit.
  //
  // Blocked voorbelasting and exempt turnover are two different facts about two different sides of
  // the ledger, and they do not have to occur in the same quarter. A physio who buys a EUR 3.000
  // treatment table in January and treats their first patient in April has EUR 630 withheld from
  // 5b in Q1 with no exempt turnover to pair it with; so does a dentist in a quarter that happens
  // to hold only taxed whitening. Nested, the only sentence explaining why 5b is EUR 630 lower
  // than the purchase invoices say never appeared — the figure was right and looked like a bug.
  // (Rounding made it worse: EUR 0,40 of exempt turnover rounds to 0 and took the note with it.)
  const geblokkeerd = euro(input.voorbelastingGeblokkeerd ?? 0);
  if (geblokkeerd > 0) {
    notes.push(
      `€${geblokkeerd.toLocaleString("nl-NL")} BTW op inkopen die je volledig aan je VRIJGESTELDE werk hebt ` +
      "toegewezen is NIET in 5b meegeteld. Dat is geen fout: bij vrijgestelde omzet bestaat er geen recht op aftrek.",
    );
  }
  // [VRIJGESTELD] The boundary of this feature, in the concept the owner actually reads — not
  // only in a migration header they never will. A till Z-report has no exempt column and a cash
  // sale carries no exempt flag, so for a declared exempt owner that turnover was booked as
  // TAXED without anyone being asked. Saying nothing would let a physio with a cash book read a
  // concept that looks complete and is not.
  const onclassificeerbaar = euro(input.onclassificeerbareOmzet ?? 0);
  if (input.exemptRegime && onclassificeerbaar > 0) {
    notes.push(
      `LET OP: €${onclassificeerbaar.toLocaleString("nl-NL")} omzet komt uit je dagomzet (kassa) of uit ` +
      "contante verkopen. Die kunnen in BoekBrug nog NIET als vrijgesteld worden aangemerkt en zijn " +
      "hier dus als BELASTE omzet meegeteld — inclusief de BTW erover. Is een deel daarvan " +
      "vrijgesteld werk, dan klopt dit concept op dat punt niet en moet je boekhouder het corrigeren. " +
      "Verkoopfacturen kun je wel per regel op 'vrijgesteld' zetten.",
    );
  }
  // [TEGENTEKEN] Before the pro-rata note, because this one is about a document that cannot be
  // right rather than about a ratio that could not be found — the owner can fix it themselves.
  const tegenteken = euro(input.voorbelastingTegenteken ?? 0);
  if (tegenteken > 0) {
    // De RICHTING wordt hier met opzet niet genoemd, en dat is een correctie op de eerste versie van
    // deze zin. "Bewust te laag" klopt bij de notitie hierboven, waar een aftrek wegvalt — maar het
    // bedrag dat hier wegvalt kan net zo goed een CREDITNOTA zijn, en dan had het 5b juist VERLAAGD.
    // Welke van de twee het is, is precies wat dit document niet zegt. Een richting noemen die we
    // niet kennen is erger dan geen richting noemen: de boekhouder rekent ermee.
    notes.push(
      `LET OP: €${tegenteken.toLocaleString("nl-NL")} BTW staat NIET in 5b, omdat op die factuur het bedrag ` +
      "en de BTW een tegengesteld teken hebben — een creditnota met positieve BTW, of andersom. Zo'n " +
      "document kan niet kloppen: een BTW-tarief is nooit negatief. Daarom weten we ook niet welke kant " +
      "het op moet: is het een creditnota, dan hoort deze BTW van 5b AF; is het een gewone factuur, dan " +
      "hoort hij ERBIJ. 5b wijkt dus €" + tegenteken.toLocaleString("nl-NL") + " af in een richting die de " +
      "factuur zelf moet uitwijzen. Leg hem ernaast en zet het bedrag of de BTW op het juiste teken; " +
      "daarna telt hij vanzelf mee.",
    );
  }
  const onopgelost = euro(input.voorbelastingUnresolved ?? 0);
  if (onopgelost > 0) {
    notes.push(
      `LET OP: €${onopgelost.toLocaleString("nl-NL")} BTW op gemengde kosten kon NIET worden verdeeld, omdat er in dit ` +
      "tijdvak geen bruikbare omzetverhouding is (geen omzet, of per saldo negatieve omzet). Die BTW staat " +
      "NIET in 5b — de voorbelasting is dus bewust te LAAG en het te betalen bedrag te hoog. Je boekhouder " +
      "bepaalt het percentage.",
    );
  }
  // [ICP] The EU-purchase note. When the caller supplies the LISTING (euPurchaseNote), that one
  // wins: it names the invoices instead of merely announcing that some exist, which is the
  // difference between a warning and something the accountant can act on. The bare sentence
  // stays as the fallback for callers that do not build the listing.
  // [ICP] When 3b could NOT take the whole intra-EU figure — capped by what the 0%-bucket held,
  // or signs that do not match — the concept and the ICP-opgaaf beside it disagree. They go to
  // the same accountant, so the difference is stated rather than left to be discovered.
  if (intraEu !== 0 && om3b !== intraEu) {
    notes.push(
      `Let op: de intracommunautaire leveringen tellen op tot €${Math.abs(intraEu).toLocaleString("nl-NL")}` +
      `${intraEu < 0 ? " negatief" : ""}, maar rubriek 3b kon er €${Math.abs(om3b).toLocaleString("nl-NL")}` +
      `${om3b < 0 ? " negatief" : ""} van opnemen — de 0%-omzet in dit kwartaal is niet groot genoeg (of heeft ` +
      "een ander teken). Dat wijst op een verkoop aan een EU-ondernemer waarop tóch BTW is berekend, of op een " +
      "creditnota uit een ander tijdvak. Controleer dit vóór je de ICP-opgaaf doet: die twee bedragen worden " +
      "naast elkaar gelegd.",
    );
  }
  if (completeness.euPurchaseNote) {
    notes.push(completeness.euPurchaseNote);
  } else if (completeness.hasEuPurchase && input.verlegdBinnenEu === undefined) {
    // Only for a caller that does not compute 4b at all; one that did says so in its own note.
    notes.push(
      "Er zijn inkopen uit het buitenland (EU). BTW-verlegging (rubriek 4b) en de bijbehorende voorbelasting " +
      "worden hier NIET automatisch berekend — je boekhouder verwerkt dit.",
    );
  }
  if ((completeness.datelessVerifiedCount ?? 0) > 0) {
    const n = completeness.datelessVerifiedCount ?? 0;
    notes.push(
      `Let op: ${telWoord(n, "geverifieerde factuur")} ${vervoeg(n, "heeft", "hebben")} geen factuurdatum en ${vervoeg(n, "telt", "tellen")} ` +
      "daarom NIET mee in dit kwartaal — voer de factuurdatum in zodat de omzet/voorbelasting compleet is.",
    );
  }
  // [REGIME-FLAGS] Special-regime notes last (KOR / verlegd / marge) — the concept is only a
  // mapping of the rate we read; these regimes change what the accountant must file.
  // [VERLEGD-NAAR-MIJ] De rubriek zegt zichzelf niet uit. Het tarief staat NIET op een verlegde
  // factuur — die draagt geen BTW — dus het is afgeleid uit wat er geleverd is, en dat hoort de
  // eigenaar te weten voordat zijn boekhouder het indient.
  if (verlegd && verlegd.aantal > 0) {
    // [VERLEGD-AFTREK] The middle sentence states what 5b really took back, because "per saldo
    // betaal je er niets over" is only true for an owner with a full right of deduction.
    const aftrekZin = input.korActive
      ? "Die BTW staat als verschuldigd in rubriek 2a. Onder de KOR heb je geen recht op aftrek, dus in " +
        "5b komt er niets van terug: je betaalt die BTW."
      : verlegdAftrek === verlegdBtw
        ? "Die BTW staat als verschuldigd in rubriek 2a én is in dezelfde aangifte weer afgetrokken (5b), " +
          "dus per saldo betaal je er niets over."
        : `Die BTW (€${verlegdBtw.toLocaleString("nl-NL")}) staat als verschuldigd in rubriek 2a; daarvan is ` +
          `€${verlegdAftrek.toLocaleString("nl-NL")} in 5b afgetrokken, volgens je toewijzing van die inkopen aan ` +
          "belast of vrijgesteld werk en je pro-rata-percentage. Het verschil betaal je.";
    notes.push(
      `Er ${verlegd.aantal === 1 ? "is 1 inkoopfactuur" : `zijn ${verlegd.aantal} inkoopfacturen`} waarop de ` +
      `leverancier de BTW naar jou heeft verlegd. ${aftrekZin} Let op: op ` +
      "zo'n factuur staat GEEN tarief — dat volgt uit wat er geleverd is. Controleer dat met je boekhouder.",
    );
  }
  // [BUITENLANDSE-INKOOP] Each of the two rubrieken says what it took and what came back, like 2a.
  const buitenlandNote = (
    code: "4a" | "4b",
    v: { grondslag: number; btw: number; aantal: number } | null | undefined,
    aftrek: number,
  ): void => {
    if (!v || v.aantal === 0) return;
    const waar = code === "4a" ? "buiten de EU" : "in een ander EU-land";
    const facturen = v.aantal === 1 ? "is 1 inkoopfactuur" : `zijn ${v.aantal} inkoopfacturen`;
    const btw = euro(v.btw);
    const rest = input.korActive
      ? "Onder de KOR heb je geen recht op aftrek, dus in 5b komt er niets van terug: je betaalt die btw."
      : aftrek === btw
        ? "Dezelfde btw is in 5b weer afgetrokken, dus per saldo betaal je er niets over."
        : `Daarvan is €${aftrek.toLocaleString("nl-NL")} in 5b afgetrokken, volgens je toewijzing van die inkopen en je pro-rata-percentage; het verschil betaal je.`;
    notes.push(
      `Er ${facturen} van een leverancier ${waar} zonder btw: die btw is naar jou verlegd en staat als verschuldigd in ` +
      `rubriek ${code} (€${btw.toLocaleString("nl-NL")} over €${euro(v.grondslag).toLocaleString("nl-NL")}, tegen het ` +
      `voorgestelde tarief van ${VERLEGD_DEFAULT_RATE}%). ${rest} Het tarief staat niet op zo'n factuur — controleer het per factuur met je boekhouder.`,
    );
  };
  buitenlandNote("4a", input.verlegdBuitenEu, v4a.aftrek);
  buitenlandNote("4b", input.verlegdBinnenEu, v4b.aftrek);
  for (const rn of regimeNotes ?? []) notes.push(rn);

  return {
    quarterLabel,
    rows,
    verschuldigd,
    voorbelasting,
    saldo,
    cashOmzetZonderBtw: euro(input.cashOmzetZonderBtw),
    vrijgesteldeOmzet: euro(input.vrijgesteldeOmzet ?? 0),
    notes,
    korActive: kor,
    isConcept: true,
  };
}

/**
 * [AANGIFTE] The concept aangifte as a CSV for the accountant's closing package — the
 * rubrieken + 5a/5b/5g + the honest notes. RAW concept only ("geen ingediende aangifte");
 * it travels WITH the evidence (invoice PDFs, dagomzet.csv, bank statement) in the same
 * ZIP, so every figure is traceable to its source. Pure (semicolon CSV, Excel-NL).
 */
// [PRIVEGEBRUIK] Rubriek 1d — the correction this app cannot compute, and never mentioned.
//
// WHAT IS MISSING
// BTW is owed on the PRIVATE use of business goods and services: a van also driven privately,
// a phone or internet subscription used at home, electricity, goods taken from stock. That
// correction belongs in rubriek 1d, in the LAST aangifte of the year. This app builds
// 1a/1b/1c/1e/3b and has never had a 1d — not in the concept, not in a note, nowhere.
//
// WHY IT IS A NOTE AND NOT A FIGURE
// The inputs simply are not here: the catalogue value of a vehicle, the private kilometres, the
// private share of a subscription. Computing 1d would mean inventing all three. Same rule as
// rubriek 4b (EU purchases) right above: say plainly that it is not computed, never guess.
//
// WHY IT IS SAID BEFORE Q4 AS WELL
// A note that only appears in the last quarter arrives too late to act on. The correction can
// only be substantiated with records kept DURING the year — a kilometre administration cannot
// be reconstructed in January. So Q1–Q3 get the one thing still actionable then (keep the
// records), and Q4 gets the actual instruction (it belongs in THIS filing).
//
// The failure direction matters: leaving 1d out means declaring too LITTLE BTW, which surfaces
// as a naheffing with belastingrente — the owner never finds out on their own. That is exactly
// the kind of silence this product refuses.
export function privegebruikNote(quarter: 1 | 2 | 3 | 4): string {
  return quarter === 4
    ? "Privégebruik (rubriek 1d) hoort in DEZE aangifte — de laatste van het jaar — en wordt hier " +
      "NIET berekend. Gebruik je zakelijke spullen ook privé (auto, telefoon, internet, energie, " +
      "goederen uit voorraad), dan is daarover BTW verschuldigd. Je boekhouder bepaalt het bedrag."
    : "Denk aan het privégebruik (rubriek 1d): de BTW-correctie over zakelijk gebruik dat ook privé " +
      "is (auto, telefoon, internet, energie) komt in de LAATSTE aangifte van het jaar. Die wordt " +
      "hier niet berekend en kan alleen worden onderbouwd met gegevens die je NU bijhoudt — " +
      "bijvoorbeeld een kilometeradministratie.";
}

export function buildAangifteCsv(a: ConceptAangifte): string {
  const EUR = (n: number) => n.toFixed(2).replace(".", ",");
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[;\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const L: string[] = [];
  L.push(`BoekBrug — Concept BTW-aangifte ${a.quarterLabel}`);
  L.push("LET OP: concept op basis van de ingevoerde gegevens — GEEN ingediende aangifte. De boekhouder controleert en dient in.");
  // [KOR-AANGIFTE-UIT] The accountant opening this next to the evidence must not read empty
  // rubrieken as missing data.
  if (a.korActive) {
    L.push("KOR actief: geen btw-aangifte. Alleen de rubrieken hieronder zijn (toch) verschuldigd; is de lijst leeg, dan is er niets aan te geven.");
  }
  L.push("");
  L.push(["Rubriek", "Omschrijving", "Omzet", "BTW"].map(esc).join(";"));
  for (const r of a.rows) {
    L.push([r.code, r.label, EUR(r.omzet), r.btw ? EUR(r.btw) : ""].map(esc).join(";"));
  }
  L.push("");
  L.push(["5a", "Verschuldigde omzetbelasting", "", EUR(a.verschuldigd)].map(esc).join(";"));
  L.push(["5b", "Voorbelasting", "", EUR(a.voorbelasting)].map(esc).join(";"));
  L.push(["5g", `Concept ${a.saldo >= 0 ? "te betalen" : "terug te ontvangen"}`, "", EUR(Math.abs(a.saldo))].map(esc).join(";"));
  L.push("");
  L.push("Waar dit op gebaseerd is (controleer voor indiening):");
  for (const n of a.notes) L.push(esc(n));
  return L.join("\r\n");
}
