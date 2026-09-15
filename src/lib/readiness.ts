// src/lib/readiness.ts
// [READINESS] The owner's one question — "ben ik klaar voor de boekhouder?" — answered by
// a PURE projection over the financial-truth layer already built (invoices, bank
// reconciliation, till/cash reconciliation, BTW). No new financial logic: it consumes
// signals other modules compute and turns them into ONE verdict + the few things that
// need attention. Fully testable (run: npx tsx src/lib/readiness.test.ts).
//
import type { RegimeFlag } from "./regime-flags";
import { BAD_DEBT_MIN_EUR } from "./bad-debt";
import { telWoord, vervoeg } from "./nl-plural";
// [BTW-ONGECONTROLEERD] € 1.234,56 in de zin die het bedrag noemt.
import { formatEuroNL } from "./format-nl";

// THE SCORE IS NOT COSMETIC. Every point is earned by a PROVABLE condition:
//   score = 100 × Σ(weight·subscore over APPLICABLE dimensions) / Σ(weight over applicable)
// A dimension we cannot measure for this owner (e.g. till reconciliation for a ZZP with no
// turnover) is marked n.v.t. and EXCLUDED from the denominator — never faked to 100%. Each
// dimension's subscore is a ratio of resolved/total real items, so "87%" means literally
// "87% of the applicable readiness checks pass", and the checks are listed. The first time
// the app says a number the boekhouder can disprove, trust is gone — so we only claim what
// the data proves, and every limit is stated in `notes`.

export interface ReadinessSignals {
  quarterLabel: string;                 // "Q1 2026"
  // [AUTO-EXCLUDE-REVIEW] The numeric quarter, so a deep-link can scope the review list to
  // EXACTLY the lines a quarter-scoped count flagged (counted ⟺ shown). Optional so older
  // callers/tests keep compiling (absent → the link opens the all-time review list).
  year?: number;
  quarter?: number;

  // ── Invoices (evidence) ──
  verifiedInvoiceCount: number;         // verified in/out invoices in the quarter
  invoicesWithEvidence: number;         // of those, how many carry a source PDF/document
  missingEvidence: string[];            // invoice numbers (or ids) lacking a stored PDF
  // [PACKAGE-READINESS] Invoices dated in this quarter STILL in the verify queue
  // (status processing/draft). They are real bills the owner hasn't confirmed, so they
  // do NOT count as verified above and would reach the accountant NOWHERE. A genuine
  // "missing invoice" gap — it must block "klaar" until the owner clears the queue.
  // Optional so older callers/tests keep compiling (undefined → 0 → no block).
  unverifiedInvoiceCount?: number;
  // [AUTO-ADVANCE] Invoices the app auto-verified (clean + confident) without a manual tap.
  // They ARE booked correctly in the common case, so this does NOT block "klaar" — but the
  // owner should eyeball them before closing (a confidently-consistent misread has no other
  // human catch). Surfaced as a RISK, not a gap. Optional (undefined → 0 → no nudge).
  autoVerifiedCount?: number;
  // [DUBBEL-TERUGKIJKEN] Facturen die twee keer in de boeken staan — dezelfde rekening, twee
  // boekingen, dus dezelfde BTW twee keer afgetrokken.
  //
  // Waarom dit hier hoort en niet alleen bij de intake: de dubbelcontrole draait op het moment dat
  // een document BINNENKOMT, en hij bestaat pas sinds 18 augustus. Alles wat daarvóór is
  // ingelezen, of in bulk is geïmporteerd, is nooit langs die poort gekomen — en er is niets dat
  // ooit terugkijkt. Op deze administratie leverde de terugblik er zes op, waarvan twee met een
  // ander bedrag onder hetzelfde nummer (€ 222,05 naast € 239,47) en één nummer dat drie keer
  // voorkomt. Geen van de zes draagt een vlag, want de vlag bestond nog niet toen ze binnenkwamen.
  //
  // Een RISICO en geen gat: de app mag niet zelf beslissen welke van de twee de echte is. Dat
  // staat op het papier, niet in de database — zie existing-duplicates.ts. Optioneel, dus een
  // oudere aanroeper telt gewoon nul en er verandert niets.
  //
  // ── DE GRENS VAN DEZE KAART, EXPLICIET ──
  // Dit telt alleen de dubbelen van DIT kwartaal, want dat is wat dit rapport is. Op deze
  // administratie liggen de zes in Q1 (drie) en Q2 (drie), dus wie het scherm in Q3 opent ziet
  // hier niets — hij ziet ze zodra hij Q1 of Q2 kiest, en dat is ook precies het moment waarop ze
  // ertoe doen: bij het afsluiten van dat kwartaal.
  //
  // Dat is een bewuste keuze en geen omissie, maar hij is het waard om op te schrijven, want
  // "staat op de klaar-kaart" en "je ziet het vandaag" zijn niet hetzelfde. Wie ALLE dubbelen in
  // één keer wil zien, draait scripts/find-existing-duplicates.mts over de hele administratie.
  doubleBookedCount?: number;
  // De nummers zelf, zodat de zin ze kan noemen. Zonder dit stuurt de kaart de ondernemer naar een
  // lijst van zeshonderd facturen met de mededeling dat er zes fout zijn — dan is de melding het
  // werk, niet de oplossing.
  doubleBookedNumbers?: string[];
  // [GEEN-BTW-SOORT] Geboekte inkoopfacturen waarop BTW is teruggevraagd terwijl de tegenpartij
  // een soort is die geen aftrekbare BTW draagt — een verzekeraar (assurantiebelasting is óók 21%),
  // horeca (art. 15 lid 5), een pensioenfonds. Aantal én de namen, want een getal zonder namen is
  // een verwijt zonder adres. Zie btw-soort.ts.
  vatDoubtCount?: number;
  vatDoubtNames?: string[];
  // [BTW-ONGECONTROLEERD] Geboekte inkoopfacturen met een GEMENGD btw-tarief en zonder de
  // tariefspecificatie die het enige bewijs is. De identiteit klopt, het tarief bewijst niets, en
  // er is dus voorbelasting teruggevraagd die niets in deze app ooit heeft kunnen nakijken. Zie
  // btw-ongecontroleerd.ts; de weg terug bestaat al ([SPLIT-ALSNOG]) en is per factuur.
  uncheckedVatCount?: number;
  uncheckedVatAmount?: number;
  uncheckedVatNames?: string[];

  // ── Bank ──
  bankTxCount: number;                  // bank transactions DATED in the quarter
  undocumentedCount: number;            // pending outgoing costs still without a document
  // [TRUST-READY] pending INCOMING payments (credits) with no linked invoice AND no
  // category — money in we cannot yet explain. Was invisible to readiness (a credit
  // never "needs a document"), so a payment with no invoice behind it scored the
  // quarter "100% klaar". A genuine gap: revenue the accountant can't tie to a sale.
  unmatchedIncomeCount: number;
  // [RD6] Bank credits the owner categorised 'omzet' (so they're booked as NEW revenue) whose exact
  // amount also matches an existing invoice's gross — probably an invoice PAYMENT mis-tapped as
  // omzet, which would double-count the sale (the invoice already booked it on its own date). A
  // risk to eyeball, not a hard block. Optional (older callers omit it → treated as 0).
  probablePaymentAsOmzetCount?: number;
  // [AUTO-EXCLUDE-REVIEW] Bank lines the app AUTO-CODED (category_confirmed=false) into an EXCLUDED
  // identity — privé / overboeking / belasting (pnlRole 'excluded') — that the owner never reviewed.
  // An excluded line is removed from omzet, kosten AND BTW entirely, and it is invisible to every
  // other readiness signal (undocumentedCount skips non-'kosten'; unmatchedIncomeCount needs a null
  // category). So a real business receipt or cost the classifier MISlabelled (a look-alike name, a
  // memory-key collision) silently falls out of the whole administration with no trace — a hidden
  // cost/revenue (constraint #1) that a green "klaar" would paper over (constraint #3). A RISK, never
  // a hard block: these are USUALLY correct (BTW payments, ATM, private withdrawals), so blocking
  // every quarter would make the verdict useless — but the owner must be told to eyeball them once.
  // Self-clearing: confirming a line (category_confirmed=true) drops it from this count. Optional
  // (undefined → 0 → no risk) so older callers/tests are unchanged.
  unreviewedExcludedCount?: number;
  // [KAS-AUTO-BOOK] Bank links this quarter that the app made on AMOUNT + supplier name alone
  // (auto_match_reason='amount_only'), still unconfirmed by the owner. Under the kasstelsel those
  // now book themselves as long as the quarter is not yet declared — and that permission rests
  // entirely on the mistake being reversible until filing. So the quarter-close is where they have
  // to be offered for a look; after filing, the same correction is a suppletie. A RISK (they are
  // usually right, and blocking would make the verdict useless), never a gap. Optional
  // (undefined → 0 → no risk) so older callers/tests are unchanged.
  amountOnlyBookingCount?: number;
  // [STATEMENT-CONTINUITY] Gaten TUSSEN de ingelezen bankafschriften: een ontbrekende periode
  // (januari en maart geüpload, februari vergeten) of een saldobreuk (het ene afschrift eindigt
  // op een ander bedrag dan waarmee het volgende begint). Dit is onzichtbaar voor elke andere
  // controle hier: de twee bestanden die er WEL zijn kloppen allebei perfect, en `bankTxCount`
  // is niet nul — dus de hele maand betalingen ertussen viel stil weg. Een ontbrekend afschrift
  // is een echt gat (facturen die betaald lijken, omzet die niet aansluit), dus het BLOKKEERT:
  // over een periode die je niet hebt, kan niemand zeggen dat het klopt. Elke string is één
  // afgeronde zin uit bank-statement-continuity.ts. Optioneel (undefined → geen melding).
  bankGapMessages?: string[];

  // ── Till / cash reconciliation (retail triangle: till ⇄ bank ⇄ drawer) ──
  usesTurnover: boolean;                // daily_turnover rows exist → the triangle applies
  turnoverDays: number;                 // days of dagomzet imported
  reconExceptions: ReconException[];    // days whose witnesses disagree beyond tolerance

  // ── BTW ──
  hasSales: boolean;                    // any sales source at all (invoices/cash/turnover)
  cashOmzetZonderBtw: number;           // euros of omzet with NO rate assigned (cash + bank + till)
  // Of cashOmzetZonderBtw, the portion from BANK revenue or an un-split till day. > 0 → the
  // rate split needs the Z-report (dagomzet), so the fix points there, not to Kas. Optional
  // so older callers keep compiling (undefined → treated as 0 → the old Kas/Dagomzet rule).
  omzetZonderBtwNonCash?: number;
  quarterDays: number;                  // calendar days in the quarter
  hasUndecidableRate: boolean;          // a sale landed in rubriek 1c (mis-derived rate)
  hasEuPurchase: boolean;               // an EU inkoop (rubriek 4b — computed in the concept at the proposed rate)
  // [KAS-NEGATIEF] The lowest point the cash drawer reached this quarter, when it went BELOW zero
  // (from lowestDrawerPoint). A negative kassaldo is physically impossible and the single biggest
  // red flag the Belastingdienst uses to reject a cash administration (it implies hidden omzet), so
  // it must BLOCK "klaar". Optional so older callers/tests keep compiling (undefined → no block).
  negativeCashDay?: { date: string; balance: number } | null;
  // [REGIME-FLAGS] Special BTW regimes the concept aangifte does NOT auto-compute (KOR active,
  // BTW verlegd, margeregeling). They do NOT block "klaar" — the owner did their part by
  // importing the data — but they must travel to the accountant flagged, so they surface as
  // RISKS. Optional so older callers/tests keep compiling (undefined → none).
  regimeFlags?: RegimeFlag[];
  // [KASSTELSEL] Under cash basis: paid money we could NOT date must BLOCK "klaar" — it would
  // otherwise silently under-declare the quarter's BTW. estimatedPaidCount (paid-date only an
  // estimate) also blocks, because a wrong estimate places the BTW in the wrong quarter. Both
  // optional (undefined → 0 → no block) so factuur callers/tests are unchanged.
  undatedPaidCount?: number;
  estimatedPaidCount?: number;
  // [DATE-GAP] Geverifieerde facturen ZONDER factuurdatum. Postgres-bereikfilters
  // (.gte/.lte op invoice_date) laten NULL-rijen stil vallen, dus zo'n factuur hoort bij deze
  // eigenaar, is gecontroleerd, en zit tóch in GEEN enkel kwartaalpakket en in GEEN enkele
  // concept-aangifte — haar BTW verdwijnt gewoon. Elke andere plek in de app rekent er al mee
  // (het pakket waarschuwt erover); alleen dit scherm, dat het eindoordeel "ben ik klaar?"
  // uitspreekt, wist er niets van en kon dus 100% klaar melden terwijl er geld buiten beeld lag.
  //
  // Bewust een RISICO en geen ontbrekend item: de telling is ALL-TIME, dus een harde blokkade
  // zou al ingediende kwartalen voorgoed rood zetten — ook op het werkbord van de boekhouder.
  // Als risico trekt hij de eerlijkheidsgrens hieronder (100 → 99) en is "stil klaar" onmogelijk.
  datelessInvoiceCount?: number;
  // [BAD-DEBT] Sales invoices > 1 year past due and still unpaid (factuur only): the BTW paid on
  // them is reclaimable (oninbare vordering). A helpful nudge (risk), never a block — it's money to
  // get back, not a gap. Optional (undefined → none).
  badDebt?: { count: number; reclaimableBtw: number };
  // [BAD-DEBT] The mirror (art. 29 lid 7): purchase invoices >1 year past due and still unpaid, so
  // the voorbelasting deducted on them has become payable again. A risk, not a block — the app
  // knows the invoice is unpaid in its own records, which is not proof it is unpaid in the world.
  // Optional (undefined → none).
  vatClawback?: { count: number; repayableBtw: number };
  // [ICP] Sales to EU businesses that cannot go on the ICP-opgaaf as they stand (BTW charged, or
  // a VAT number that cannot be right). The opgaaf itself is not a readiness matter; one that
  // will be REJECTED is, because a rejected opgaaf counts as not done. Optional (undefined → 0).
  icpProblems?: number;
  // [DATE-GAP] Verified invoices with NO invoice_date. A date-range fetch drops them, so they are
  // in NONE of this quarter's figures — omzet, kosten and voorbelasting are all quietly too low.
  // /api/aangifte already warns about exactly this; readiness said nothing. Optional (→ 0).
  datelessVerifiedCount?: number;
}

export interface ReconException {
  date: string;                         // 'YYYY-MM-DD'
  kind: string;                         // pin | cash | internal | unknown
  note: string;                         // human-readable
  diff: number;                         // signed euro gap
}

export type DimensionKey = "invoices" | "bank" | "cash" | "vat";

export interface ReadinessDimension {
  key: DimensionKey;
  label: string;                        // Dutch
  weight: number;                       // 30 / 30 / 20 / 20
  applicable: boolean;                  // false → n.v.t., excluded from the score
  subscore: number;                     // 0..1 (0 when not applicable)
  detail: string;                       // Dutch, what this dimension found
}

export interface ReadinessItem {
  severity: "missing" | "risk";         // missing = a gap that lowers readiness;
                                        // risk = a reconciliation signal to eyeball
  title: string;                        // Dutch, specific
  detail?: string;
  // [ACTIONABLE] Where the owner fixes THIS gap. A readiness item that only STATES a
  // problem with no way to act on it is a dead-end — the owner has to hunt the menu. Set
  // only when the destination is unambiguous; omitted when we can't be sure (better no
  // link than a wrong one). The UI renders the item as a tap-through when present.
  fix?: { label: string; href: string };
}

// The owner-facing fix destinations (dashboard routes). Kept here so the gap and its
// remedy are defined together and never drift.
const FIX = {
  bank: { label: "Naar Bank", href: "/dashboard/bank" },
  /**
   * [BANK-QUARTER-LINK] The bank page defaults to the LAST COMPLETED quarter, so a bare
   * /dashboard/bank sends the owner to the wrong one whenever the gap is not in that quarter.
   * In August a Q1 income blocker opened Q2: every list read 0, and the only honest reading of
   * an empty screen is "this was already handled" — the worst answer a blocker can produce.
   * Pins the quarter the gap is actually about; falls back to the bare route when we don't know
   * it, because a wrong quarter is worse than none. Mirrors the excluded-review link below.
   */
  bankQuarter: (year?: number | null, quarter?: number | null) => ({
    label: "Naar Bank",
    href: year && quarter ? `/dashboard/bank?year=${year}&quarter=${quarter}` : "/dashboard/bank",
  }),
  dagomzet: { label: "Naar Dagomzet", href: "/dashboard/dagomzet" },
  kas: { label: "Naar Kas", href: "/dashboard/kas" },
  nieuweFactuur: { label: "Omzet invoeren", href: "/dashboard/invoice/new" },
  facturen: { label: "Naar Facturen", href: "/dashboard/facturen" },
} as const;

export type ReadinessStatus = "ready" | "almost" | "attention";

export interface ReadinessReport {
  quarterLabel: string;
  score: number;                        // 0..100, whole number
  status: ReadinessStatus;
  ready: boolean;                       // status === "ready"
  dimensions: ReadinessDimension[];     // the rubric, always all four (some n.v.t.)
  missing: ReadinessItem[];             // fix-these — gaps
  risks: ReadinessItem[];               // eyeball-these — reconciliation differences
  notes: string[];                      // honest limits of this verdict
}

const DIM_LABEL: Record<DimensionKey, string> = {
  invoices: "Facturen & bonnen",
  bank: "Bank verwerkt",
  cash: "Kassa & kas sluit aan",
  vat: "BTW compleet",
};
const DIM_WEIGHT: Record<DimensionKey, number> = { invoices: 30, bank: 30, cash: 20, vat: 20 };

const euro = (n: number) => Math.round(n);
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Build the readiness verdict from the signals. Pure — the caller gathers the signals
 * (from summarizeClosingPackage / computeResult / buildTurnoverClosing / buildAangifte)
 * and this decides the score, the status, and the two short lists.
 */
export function buildReadiness(s: ReadinessSignals): ReadinessReport {
  const dimensions: ReadinessDimension[] = [];
  const missing: ReadinessItem[] = [];
  const risks: ReadinessItem[] = [];
  const notes: string[] = [];

  // ── 1) Invoices & bonnen (30%) — every verified invoice must carry its source PDF ──
  {
    const applicable = s.verifiedInvoiceCount > 0;
    const withEv = Math.min(s.invoicesWithEvidence, s.verifiedInvoiceCount);
    const subscore = applicable ? clamp01(withEv / s.verifiedInvoiceCount) : 0;
    const gap = s.verifiedInvoiceCount - withEv;
    dimensions.push({
      key: "invoices",
      label: DIM_LABEL.invoices,
      weight: DIM_WEIGHT.invoices,
      applicable,
      subscore,
      detail: applicable
        ? `${withEv} van ${s.verifiedInvoiceCount} facturen met origineel document.`
        : "Geen facturen in dit kwartaal — dit onderdeel telt niet mee.",
    });
    if (applicable && gap > 0) {
      missing.push({
        severity: "missing",
        title: gap === 1 ? "1 factuur mist het originele document" : `${gap} facturen missen het originele document`,
        detail: s.missingEvidence.length
          ? `Zonder PDF: ${s.missingEvidence.slice(0, 5).join(", ")}${s.missingEvidence.length > 5 ? " …" : ""}. De boekhouder kan deze niet controleren — voeg het origineel toe.`
          : "De boekhouder kan deze niet controleren zonder de bon/factuur — voeg het origineel toe.",
        // [ORIGINEEL] This was the ONE item in the whole report with no fix link, and the reason was
        // not an oversight in the report: until now there was nowhere for it to point. document_id
        // was written at creation and by nothing afterwards, so an invoice without its original
        // could never be given one — the accountant asked every quarter and the client could not
        // answer. The tab holds exactly the counted set (confirmed, no document), so following the
        // link and clearing it clears the item.
        fix: { label: "Origineel toevoegen", href: "/dashboard/incoming/manage?filter=geen-document" },
      });
    }
    // [PACKAGE-READINESS] Unverified invoices dated in the quarter block "klaar": they are
    // real bills sitting in the verify queue and would never reach the accountant. This is
    // separate from the evidence gap above (that's about verified invoices without a PDF).
    const unverified = s.unverifiedInvoiceCount ?? 0;
    if (unverified > 0) {
      missing.push({
        severity: "missing",
        title:
          unverified === 1
            ? "1 factuur staat nog in de verwerkingsrij"
            : `${unverified} facturen staan nog in de verwerkingsrij`,
        detail: "Controleer en bevestig deze facturen voordat je afsluit — anders gaan ze niet mee naar de boekhouder.",
        // Label names the screen it opens (Inkomend), not "Facturen" — which is a
        // different screen in this app (outgoing sales invoices).
        fix: { label: "Naar Inkomend", href: "/dashboard/incoming" },
      });
    }
    if (!applicable) notes.push("Nog geen facturen geïmporteerd voor dit kwartaal.");

    // [AUTO-ADVANCE] Auto-verified invoices are booked, but the quarter-close is the moment to
    // eyeball them — a confidently-consistent misread has no other human catch. A RISK (review),
    // never a blocking gap, so daily automation stays hands-off.
    const autoV = s.autoVerifiedCount ?? 0;
    if (autoV > 0) {
      risks.push({
        severity: "risk",
        title: autoV === 1 ? "1 factuur is automatisch verwerkt" : `${autoV} facturen zijn automatisch verwerkt`,
        detail: "De app heeft deze duidelijk leesbare facturen automatisch geverifieerd. Loop ze even na (tab 'Automatisch verwerkt') voordat je afsluit.",
        // The detail names the tab, so the link opens that tab (?filter=auto) instead of
        // the full ledger the owner would then have to filter by hand.
        fix: { label: "Bekijk", href: "/dashboard/incoming/manage?filter=auto" },
      });
    }
  }

  // ── [DUBBEL-TERUGKIJKEN] Dezelfde rekening, twee keer geboekt ──────────────────────────────
  {
    const dubbel = s.doubleBookedCount ?? 0;
    // Hooguit vier bij naam: een zin met dertig factuurnummers wordt niet gelezen.
    const alle = s.doubleBookedNumbers ?? [];
    const namen = alle.slice(0, 4).map((n) => `factuur ${n}`);
    if (alle.length > 4) namen.push(`en ${alle.length - 4} andere`);
    if (dubbel > 0) {
      risks.push({
        severity: "risk",
        title:
          dubbel === 1
            ? "1 factuur staat twee keer in je boeken"
            : `${dubbel} facturen staan twee keer in je boeken`,
        detail:
          "Dezelfde rekening is twee keer geboekt, dus dezelfde BTW is twee keer afgetrokken. " +
          (namen.length > 0 ? `Het gaat om ${namen.join(", ")}. ` : "") +
          "Welke van de twee de echte is, staat op het papier — de app verandert er niets aan. " +
          "Zoek het nummer op, leg ze naast elkaar en archiveer de dubbele.",
        // Géén ?filter=dubbel: dat tabblad bestaat niet, en een onbekende filterwaarde valt terug
        // op "Alle". De ondernemer zou dan in het volledige grootboek landen met de mededeling dat
        // er ergens zes fout zijn — precies de dode belofte waar [SEGMENT-VOORDEUR] een poort voor
        // heeft. De nummers staan hierboven; die zijn hier het gereedschap.
        fix: { label: "Naar de facturen", href: "/dashboard/incoming/manage" },
      });
    }
  }

  // ── [BTW-ONGECONTROLEERD] Teruggevraagde BTW die niets heeft kunnen nakijken ────────────────
  //
  // Elke rekenkundige controle in deze app leunt op één van twee dingen: de identiteit
  // (excl + btw = totaal) of het TARIEF (0, 9 of 21 — meer bestaan er niet). Een factuur met twee
  // tarieven erop voldoet aan de eerste per constructie en ontsnapt aan de tweede: met 9% en 21%
  // door elkaar mag het gemengde percentage alles daartussen zijn, dus "12,4%" bewijst niets.
  //
  // Wat overblijft is de tariefspecificatie op het papier, en zonder die is er geen enkele getuige.
  // Zo'n factuur ziet er op elk scherm volstrekt schoon uit terwijl de voorbelasting nooit is
  // nagekeken. Dit is dus geen verwijt en geen fout — bij een groothandel is een gemengd tarief
  // volkomen normaal — maar het hoort wel gezegd te worden op de plek waar de eigenaar vraagt of
  // het kwartaal de deur uit kan.
  {
    const aantal = s.uncheckedVatCount ?? 0;
    const bedrag = s.uncheckedVatAmount ?? 0;
    const namen = (s.uncheckedVatNames ?? []).slice(0, 4);
    const rest = (s.uncheckedVatNames ?? []).length - namen.length;
    if (rest > 0) namen.push(`en ${rest} andere`);
    if (aantal > 0) {
      risks.push({
        severity: "risk",
        title:
          aantal === 1
            ? "1 factuur vraagt BTW terug die we niet hebben kunnen nakijken"
            : `${aantal} facturen vragen BTW terug die we niet hebben kunnen nakijken`,
        detail:
          "Op deze facturen staan twee btw-tarieven door elkaar, en de uitsplitsing per tarief " +
          "ontbreekt. Dan klopt de optelling wel, maar is er niets waaraan we het bedrag kunnen " +
          "toetsen. " +
          (bedrag > 0 ? `Het gaat om ${formatEuroNL(bedrag)} aan voorbelasting. ` : "") +
          (namen.length > 0 ? `Bij ${namen.join(", ")}. ` : "") +
          "Open zo'n factuur en laat de btw alsnog nakijken; er wordt niets overschreven.",
        fix: { label: "Naar de facturen", href: "/dashboard/incoming/manage" },
      });
    }
  }

  // ── [GEEN-BTW-SOORT] Teruggevraagde BTW die misschien geen BTW is ──────────────────────────
  //
  // Anders dan de dubbele boekingen hierboven is dit geen leesfout. Het document klopt, de
  // optelling klopt, elke poort in deze app is groen — en het bedrag is toch niet terug te vragen,
  // omdat het een ANDERE BELASTING is. Assurantiebelasting is 21%, net als BTW, en staat op een
  // verzekeringsnota op precies de plek waar BTW zou staan.
  //
  // Daarom is de zin een vraag en geen oordeel: bij verhuur is 21% juist heel vaak wél correct
  // (huurder en verhuurder mogen kiezen voor btw-belaste verhuur), en een verzekeraar mag ook een
  // gewone belaste dienst factureren. De app wijst; de eigenaar of zijn boekhouder beslist.
  {
    const twijfel = s.vatDoubtCount ?? 0;
    const namen = (s.vatDoubtNames ?? []).slice(0, 4);
    const rest = (s.vatDoubtNames ?? []).length - namen.length;
    if (rest > 0) namen.push(`en ${rest} andere`);
    if (twijfel > 0) {
      risks.push({
        severity: "risk",
        title:
          twijfel === 1
            ? "1 geboekte factuur vraagt BTW terug die misschien geen BTW is"
            : `${twijfel} geboekte facturen vragen BTW terug die misschien geen BTW is`,
        detail:
          "Niet elke 21% op een nota is BTW. Een verzekeringspremie draagt assurantiebelasting — " +
          "ook 21%, maar die mag je niet terugvragen. Eten en drinken in een horecagelegenheid " +
          "draagt wél BTW, en juist die mag je niet aftrekken. " +
          (namen.length > 0 ? `Het gaat om ${namen.join(", ")}. ` : "") +
          "Kijk op het papier wat er echt staat. Klopt het, dan laat je het staan — bij verhuur " +
          "is 21% vaak gewoon juist.",
        fix: { label: "Naar de facturen", href: "/dashboard/incoming/manage" },
      });
    }
  }

  // ── 2) Bank (30%) — data present, and every line resolved (income/transfer/known cost,
  //       or a cost that has its bon). Subscore = resolved / total bank lines. ──
  {
    const applicable = true; // every business moves money; absence of data is itself a gap
    let subscore = 0;
    let detail: string;
    if (s.bankTxCount === 0) {
      subscore = 0;
      detail = "Geen banktransacties voor dit kwartaal gevonden.";
      missing.push({
        severity: "missing",
        title: "Bankafschrift ontbreekt",
        detail: "Upload het bankafschrift van dit kwartaal — zonder bank kan de boekhouder niets aansluiten.",
        fix: FIX.bankQuarter(s.year, s.quarter),
      });
    } else {
      // [NO-CODEER] The per-line "give every bank debit a category" flow is intentionally
      // NOT a readiness gap. For a retail administration costs belong on the INCOMING
      // invoice (which carries the BTW you reclaim) and revenue on the Z-report/dagomzet —
      // hand-coding a bare bank debit as a cost gives no voorbelasting and risks double
      // counting the invoice you already booked. So undocumentedCount (uncoded cost debits)
      // no longer lowers the score. The ONE bank signal that survives is unmatched INCOME:
      // money in with no invoice behind it, which would silently understate omzet — that
      // still blocks "klaar". (undocumentedCount stays computed for other surfaces; it just
      // no longer drives readiness.)
      const openBank = s.unmatchedIncomeCount;
      const resolved = Math.max(0, s.bankTxCount - openBank);
      subscore = clamp01(resolved / s.bankTxCount);
      detail = `${resolved} van ${s.bankTxCount} banktransacties verwerkt.`;
      if (s.unmatchedIncomeCount > 0) {
        // The one thing a bank check exists to catch: money in with no invoice behind
        // it. A genuine gap — it blocks "klaar" so the owner links it or explains it.
        missing.push({
          severity: "missing",
          title:
            s.unmatchedIncomeCount === 1
              ? "1 ontvangen betaling zonder factuur"
              : `${s.unmatchedIncomeCount} ontvangen betalingen zonder factuur`,
          detail: "Koppel de betaling aan een factuur of geef aan wat het is (bijv. huur, lening, privé). Onverklaarde omzet kan de boekhouder niet aansluiten.",
          fix: FIX.bankQuarter(s.year, s.quarter),
        });
      }
      // [STATEMENT-CONTINUITY] Ontbreekt er een STUK bankgeschiedenis? De controle hierboven kijkt
      // naar de transacties die er ZIJN; deze naar het afschrift dat er niet is. Januari en maart
      // geüpload, februari vergeten: beide bestanden kloppen intern, `bankTxCount` is niet nul, en
      // toch mist een maand aan betalingen. Dat blokkeert "klaar" — over een periode die je niet
      // hebt kan niemand zeggen dat het aansluit — en de zin noemt precies welke periode het is,
      // zodat de eigenaar dat ene bestand bij zijn bank kan ophalen.
      for (const msg of s.bankGapMessages ?? []) {
        missing.push({
          severity: "missing",
          title: "Er ontbreekt een stuk bankgeschiedenis",
          detail: msg,
          fix: FIX.bankQuarter(s.year, s.quarter),
        });
      }
      // [VOORBELASTING-RISK] Supplier-like payments (needsDocument) paid by bank with NO purchase
      // invoice behind them: the deductible BTW (voorbelasting, 5b) on those costs is not claimed,
      // so the owner would pay MORE BTW than needed. Per [NO-CODEER] we do NOT hand-code the debit
      // (coding a bare debit yields no voorbelasting and risks double-counting the invoice) — we
      // surface it as a RISK to upload the inkoopfactuur. It doesn't hard-block daily automation,
      // but it means readiness can never say "klaar" in silence while deductible BTW is missing.
      if (s.undocumentedCount > 0) {
        risks.push({
          severity: "risk",
          title:
            s.undocumentedCount === 1
              ? "1 leverancierbetaling zonder inkoopfactuur"
              : `${s.undocumentedCount} leverancierbetalingen zonder inkoopfactuur`,
          detail: "Je hebt deze kosten per bank betaald, maar er is nog geen inkoopfactuur. Upload de factuur — anders mis je de BTW-aftrek (voorbelasting) op deze kosten en betaal je te veel.",
          fix: FIX.bankQuarter(s.year, s.quarter),
        });
      }
      // [RD6] A bank credit booked as 'omzet' whose amount equals an existing invoice is probably a
      // factuurbetaling mis-tapped as revenue — booking it AND the invoice double-counts the sale.
      const dubbel = s.probablePaymentAsOmzetCount ?? 0;
      if (dubbel > 0) {
        risks.push({
          severity: "risk",
          title:
            dubbel === 1
              ? "1 ontvangst als omzet geboekt lijkt op een factuurbetaling"
              : `${dubbel} ontvangsten als omzet geboekt lijken op een factuurbetaling`,
          detail: "Het bedrag is gelijk aan een factuur. Als dit de betaling van die factuur is, koppel hem — anders telt de omzet dubbel (de factuur telt al mee).",
          fix: FIX.bankQuarter(s.year, s.quarter),
        });
      }
      // [AUTO-EXCLUDE-REVIEW] Lines the app auto-coded as privé/overboeking/belasting and the owner
      // never confirmed. These are EXCLUDED from omzet, kosten and BTW, so a MISlabelled one silently
      // hides a real receipt or cost. A RISK (self-clearing on confirm), never a block — most are
      // correct, but readiness must not say "klaar" in silence while machine-excluded money sits
      // unreviewed. Points at the review list so one pass clears the correct ones.
      const autoExcluded = s.unreviewedExcludedCount ?? 0;
      if (autoExcluded > 0) {
        // Scope the deep-link to THIS quarter AND to only the excluded (privé/overboeking/belasting)
        // lines, so the review list shows EXACTLY the counted set — counted ⟺ shown. Without the
        // quarter scope an older quarter's flagged lines could fall off the review page; without
        // only=excluded the owner would hunt the flagged rows among unrelated omzet/kosten lines and
        // the small excluded set keeps the 200-row page from truncating the oldest ones. Falls back
        // to the all-time excluded review list when the quarter isn't known.
        const reviewHref =
          s.year && s.quarter
            ? `/dashboard/bank/categoriseren?view=review&only=excluded&year=${s.year}&quarter=${s.quarter}`
            : "/dashboard/bank/categoriseren?view=review&only=excluded";
        risks.push({
          severity: "risk",
          title:
            autoExcluded === 1
              ? "1 bankregel automatisch als privé/overboeking/belasting geboekt"
              : `${autoExcluded} bankregels automatisch als privé/overboeking/belasting geboekt`,
          detail:
            `${vervoeg(autoExcluded, "Deze regel is", "Deze regels zijn")} automatisch ingedeeld als privé, overboeking of belasting en ${vervoeg(autoExcluded, "telt", "tellen")} daarom NIET mee in je omzet, kosten of BTW. Controleer eenmalig of er geen zakelijke ontvangst of kost tussen zit — die zou anders buiten je boekhouding vallen.`,
          fix: { label: "Controleer", href: reviewHref },
        });
      }
      // [KAS-AUTO-BOOK] Bank lines the app booked onto an invoice on AMOUNT + supplier name alone —
      // no invoice number in the description. They are marked auto_match_reason='amount_only' and
      // one tap unlinks them, and that reversibility is the entire reason they are allowed to book
      // themselves under the kasstelsel: the mistake stays inside the app right up until the quarter
      // is declared. Which makes THIS the moment it has to be shown. Filing without looking is what
      // would turn a wrong pick into a suppletie, so the promise "the owner reviews before filing"
      // needs a place where the review is actually offered — a promise with no mechanism is the
      // shape half of this file exists to correct.
      //
      // A RISK, never a block: these bookings are usually right, and blocking every quarter that
      // contains one would make the verdict useless. Self-clearing — confirming the link drops it.
      const flaggedBookings = s.amountOnlyBookingCount ?? 0;
      if (flaggedBookings > 0) {
        risks.push({
          severity: "risk",
          title:
            flaggedBookings === 1
              ? "1 factuur is alleen op bedrag gekoppeld"
              : `${flaggedBookings} facturen zijn alleen op bedrag gekoppeld`,
          detail:
            "De app herkende deze betalingen aan het bedrag en de naam van de leverancier, maar er stond geen factuurnummer in de omschrijving. Loop ze na vóór je de aangifte indient — daarna is corrigeren een suppletie. Eén tik maakt een koppeling los.",
          fix: { label: "Controleer", href: "/dashboard/bank?tab=done" },
        });
      }
    }
    dimensions.push({ key: "bank", label: DIM_LABEL.bank, weight: DIM_WEIGHT.bank, applicable, subscore, detail });
  }

  // ── 3) Kassa & kas (20%) — the retail triangle. Applicable ONLY when the store keeps a
  //       till (turnover): otherwise there is nothing to reconcile and we DON'T fake it. ──
  {
    const applicable = s.usesTurnover && s.turnoverDays > 0;
    let subscore = 0;
    let detail: string;
    if (!applicable) {
      detail = "Geen kassa-omzet — dit onderdeel telt niet mee.";
    } else {
      const exceptionDays = new Set(s.reconExceptions.map((e) => e.date)).size;
      const okDays = Math.max(0, s.turnoverDays - exceptionDays);
      subscore = clamp01(okDays / s.turnoverDays);
      detail = `${okDays} van ${s.turnoverDays} kassadagen sluiten aan met bank en kas.`;
      // [KAS-NEGATIEF] A negative drawer zeroes the cash subscore so the number visibly reflects the
      // red flag (the line-409 honesty guard only caps 100→99). The hard block is the missing gate
      // below (independent of till applicability); this only shapes the displayed score.
      if (s.negativeCashDay && s.negativeCashDay.balance < 0) {
        subscore = 0;
        detail = `Kassaldo negatief op ${s.negativeCashDay.date} — dit onderdeel sluit niet aan.`;
      }
      // Each disagreeing day is a RISK the owner should eyeball (not a blocking gap): it
      // travels to the accountant flagged, but a big daily gap is exactly what to catch.
      for (const e of s.reconExceptions) {
        risks.push({
          severity: "risk",
          title: `${e.date}: ${describeBreak(e)}`,
          detail: e.note,
        });
      }
    }
    dimensions.push({ key: "cash", label: DIM_LABEL.cash, weight: DIM_WEIGHT.cash, applicable, subscore, detail });
  }

  // [KAS-NEGATIEF] A negative cash balance blocks "klaar" — OUTSIDE the till-applicability guard on
  // purpose: a pure-cash ZZP (no daily_turnover → the cash dimension is n.v.t.) can still run the
  // drawer below zero, and a legally-impossible drawer must never ship as ready. Pushing a `missing`
  // item makes missing.length > 0, so the final verdict can never be "ready". Never a wrong number —
  // it computes nothing, it only refuses to say "klaar" on an impossible drawer (constraint: no
  // false reassurance). The starting float is honored (opening balance from profile), so a shop that
  // legitimately opened with cash in the till is not falsely flagged.
  if (s.negativeCashDay && s.negativeCashDay.balance < 0) {
    missing.push({
      severity: "missing",
      title: `Kassaldo negatief op ${s.negativeCashDay.date}: €${Math.abs(s.negativeCashDay.balance).toFixed(2)}`,
      detail:
        "Een negatief kassaldo kan niet — je kunt geen contant geld uitgeven dat er niet is. Dit is de grootste rode vlag voor de Belastingdienst (het wijst op niet-geboekte omzet). Controleer je beginsaldo, kasontvangsten en kasuitgaven.",
      fix: FIX.kas,
    });
  }

  // [KASSTELSEL] Under cash basis, paid money that couldn't be dated must BLOCK "klaar": its BTW
  // can't be placed in a quarter, so the aangifte would be silently too low. A hard gap (pushing
  // `missing`), with the fix pointing to the bank screen where the owner links the payment.
  const undatedPaid = s.undatedPaidCount ?? 0;
  if (undatedPaid > 0) {
    missing.push({
      severity: "missing",
      title: undatedPaid === 1
        ? "1 betaalde factuur zonder betaaldatum"
        : `${undatedPaid} betaalde facturen zonder betaaldatum`,
      detail: `Je administratie staat op kasstelsel: de BTW over je omzet telt op de betaaldatum. ${vervoeg(undatedPaid, "Deze betaalde factuur heeft", "Deze betaalde facturen hebben")} geen datum, dus de BTW kan niet in het juiste kwartaal — koppel de bankbetaling of vul de betaaldatum in.`,
      fix: FIX.bankQuarter(s.year, s.quarter),
    });
  }
  const dateless = s.datelessInvoiceCount ?? 0;
  if (dateless > 0) {
    risks.push({
      severity: "risk",
      title: dateless === 1
        ? "1 gecontroleerde factuur heeft geen datum"
        : `${dateless} gecontroleerde facturen hebben geen datum`,
      detail:
        "Zonder factuurdatum valt een factuur buiten elk kwartaal: ze komt in geen enkel " +
        "kwartaalpakket en in geen enkele concept-aangifte, dus haar BTW telt nergens mee. " +
        "Vul de datum aan, dan telt ze weer gewoon mee.",
      fix: FIX.facturen,
    });
  }
  const estimatedPaid = s.estimatedPaidCount ?? 0;
  if (estimatedPaid > 0) {
    risks.push({
      severity: "risk",
      title: estimatedPaid === 1
        ? "1 betaaldatum is een schatting"
        : `${estimatedPaid} betaaldata zijn een schatting`,
      detail: "De betaaldatum is 'handmatig betaald' i.p.v. uit een bankregel — controleer of het kwartaal klopt (onder kasstelsel bepaalt de betaaldatum het BTW-tijdvak).",
      fix: FIX.bankQuarter(s.year, s.quarter),
    });
  }

  // A business with money movement but NO recorded revenue is not a "channel we don't
  // use" — it is an incomplete quarter. `hasActivity` distinguishes an empty quarter
  // (nothing to judge → BTW genuinely n.v.t.) from a quarter that HAS bank/purchase
  // activity yet no sales side (a real gap, never n.v.t. — see the BTW block below).
  const hasActivity =
    s.bankTxCount > 0 || s.verifiedInvoiceCount > 0 || s.turnoverDays > 0 || s.cashOmzetZonderBtw > 0;

  // ── 4) BTW (20%) — is the omzet fully recorded, rated and covered? When there IS a
  //       sales side: check rating, kassadag coverage, and undecidable rate. When there
  //       is activity but NO sales side at all (bank-only): this is a GAP (subscore 0 +
  //       a 'missing' item), NOT n.v.t. — otherwise a lone bank statement would score
  //       100% "klaar" while zero revenue is recorded. Only a truly empty quarter is
  //       n.v.t. here. ──
  {
    const salesApplicable = s.hasSales;
    const applicable = s.hasSales || hasActivity;
    const checks: boolean[] = [];
    const detailBits: string[] = [];
    if (salesApplicable) {
      // a) all cash omzet has a rate
      const ratedOk = s.cashOmzetZonderBtw <= 0;
      checks.push(ratedOk);
      if (!ratedOk) {
        // [FIX-ROUTING] Where the owner splits this omzet by tarief depends on its SOURCE,
        // not just on whether the store keeps a till. Bank-received omzet (pin/card
        // settlements) and un-split till days both get their 9%/21% split from the
        // Z-report → the fix is Dagomzet. Only PLAIN cash (no bank, no till) is fixed at
        // Kas. Routing bank omzet to "Naar Kas" sent the owner to the wrong screen — the
        // common retail case (money arrives on the bank, the rate lives in the Z-report).
        const fromZReport = (s.omzetZonderBtwNonCash ?? 0) > 0;
        missing.push({
          severity: "missing",
          title: `€${euro(s.cashOmzetZonderBtw)} omzet zonder BTW-tarief`,
          detail: fromZReport
            ? "Deze omzet kwam via de bank of een kassadag binnen zonder tarief. Importeer het Z-rapport bij Dagomzet zodat de 9%/21%-verdeling meekomt — anders staat deze omzet in geen enkele rubriek."
            : "Ken 9% of 21% toe — anders staat deze omzet in geen enkele rubriek.",
          fix: fromZReport || s.usesTurnover ? FIX.dagomzet : FIX.kas,
        });
        detailBits.push("omzet zonder tarief");
      }
      // b) full kassadag coverage (only when the store uses a till)
      if (s.usesTurnover) {
        const coverageOk = s.turnoverDays >= s.quarterDays;
        checks.push(coverageOk);
        if (!coverageOk) {
          missing.push({
            severity: "missing",
            title: `${s.turnoverDays} van ${s.quarterDays} kassadagen geïmporteerd`,
            detail: "Ontbrekende dagen tellen niet mee in de omzet — controleer of alle Z-rapporten erin zitten.",
            fix: FIX.dagomzet,
          });
          detailBits.push(`${s.quarterDays - s.turnoverDays} kassadagen ontbreken`);
        }
      }
      // c) no undecidable rate slipping into rubriek 1c
      const rateOk = !s.hasUndecidableRate;
      checks.push(rateOk);
      if (!rateOk) {
        risks.push({
          severity: "risk",
          title: "Een verkoop heeft een onbekend BTW-tarief (rubriek 1c)",
          detail: "Controleer de betreffende factuur/omzet zodat de BTW in het juiste vak staat.",
        });
        detailBits.push("onbekend tarief");
      }
    }
    let subscore: number;
    let detail: string;
    if (salesApplicable) {
      const passed = checks.filter(Boolean).length;
      subscore = checks.length > 0 ? passed / checks.length : 1;
      detail = detailBits.length === 0
        ? "Omzet volledig ingedeeld per BTW-tarief."
        : `Aandacht: ${detailBits.join(", ")}.`;
      if (s.hasEuPurchase) {
        // [BUITENLANDSE-INKOOP] The concept computes 4b now, at the proposed rate; the owner's job
        // is to check the rate per invoice, not to have the rubriek placed.
        notes.push("Er zijn EU-inkopen: de verlegde btw staat in het concept in rubriek 4b, tegen het voorgestelde tarief van 21% — controleer het tarief per factuur met je boekhouder.");
      }
    } else if (applicable) {
      // Activity but no revenue recorded at all — the whole sales side is missing.
      subscore = 0;
      detail = "Nog geen omzet vastgelegd (geen verkoopfacturen, kassa of kas-omzet).";
      missing.push({
        severity: "missing",
        title: "Nog geen omzet vastgelegd",
        detail: "Er is wel bank- of inkoopactiviteit, maar geen verkoopfacturen, kassa-omzet of kas-omzet. Controleer of je omzet is ingevoerd voordat je afsluit.",
        fix: s.usesTurnover ? FIX.dagomzet : FIX.nieuweFactuur,
      });
    } else {
      subscore = 0;
      detail = "Nog geen gegevens — dit onderdeel telt niet mee.";
    }
    dimensions.push({ key: "vat", label: DIM_LABEL.vat, weight: DIM_WEIGHT.vat, applicable, subscore, detail });
  }

  // Honest limit on voorbelasting (fix D): we can only reclaim BTW on inkoopfacturen the
  // owner actually entered — an un-entered bon means the aftrek is too low. Stated when
  // there is any activity (not on a truly empty quarter).
  if (hasActivity) {
    notes.push("Voorbelasting telt alleen ingevoerde inkoopfacturen/bonnen — ontbreekt er een bon, dan is je BTW-aftrek te laag en betaal je te veel.");
  }

  // [REGIME-FLAGS] Special regimes (KOR / BTW verlegd / margeregeling) travel to the accountant
  // flagged as RISKS — never a blocking gap (the owner imported the data; the regime is the
  // accountant's to apply). A KOR-active shop, a verlegd purchase or a margeregeling sale would
  // otherwise silently ride out in a concept whose 5a is computed as if the regime didn't apply.
  for (const f of s.regimeFlags ?? []) {
    risks.push({
      severity: "risk",
      title: f.title,
      detail: f.evidence ? `${f.detail} (bijv. factuur ${f.evidence})` : f.detail,
    });
  }

  // [DATE-GAP] A verified invoice with no date is counted NOWHERE — not in omzet, not in kosten,
  // not in voorbelasting — because the quarter is fetched by date range. That makes every figure
  // on this page too low, so it is a blocking GAP, not a risk: "klaar" may not be reachable while
  // a counted document is missing from the count. The aangifte screen already says so; this is
  // the same sentence on the surface that decides whether the quarter is done.
  // It is also entirely fixable by the owner — enter the date — which is what a gap should be.
  if ((s.datelessVerifiedCount ?? 0) > 0) {
    const n = s.datelessVerifiedCount ?? 0;
    missing.push({
      severity: "missing",
      title: n === 1
        ? "1 factuur heeft geen factuurdatum"
        : `${n} facturen hebben geen factuurdatum`,
      detail:
        `${n === 1 ? "Deze factuur telt" : "Deze facturen tellen"} in GEEN enkel kwartaal mee — ` +
        "omzet, kosten en voorbelasting zijn daardoor te laag. Vul de factuurdatum in, dan valt " +
        `${n === 1 ? "hij" : "ze"} vanzelf in het juiste kwartaal.`,
      fix: FIX.facturen,
    });
  }

  // [ICP] An EU sale that cannot go on the opgaaf as it stands. Either BTW was charged to a
  // business you also listed as intra-EU, or the VAT number cannot be right — both make the
  // opgaaf bounce, and a bounced opgaaf counts as never filed. A risk, not a gap: charging BTW
  // to an EU customer is sometimes exactly correct (a service taxed in NL), so the app points
  // at the invoice and lets the owner decide which of the two is wrong.
  if ((s.icpProblems ?? 0) > 0) {
    const n = s.icpProblems ?? 0;
    risks.push({
      severity: "risk",
      title: n === 1
        ? "1 EU-verkoop kan niet in de ICP-opgaaf"
        : `${n} EU-verkopen kunnen niet in de ICP-opgaaf`,
      detail:
        "Op een verkoop aan een EU-ondernemer is BTW berekend, of het BTW-nummer heeft niet de lengte " +
        "van dat land. Bij een intracommunautaire levering verleg je de BTW (0%) en geef je de klant op " +
        "in de ICP-opgaaf — een aparte aangifte naast de BTW-aangifte. Een afgekeurde opgaaf telt als " +
        "niet gedaan; controleer het nummer (VIES) of de BTW op de factuur.",
      fix: FIX.facturen,
    });
  }

  // [BAD-DEBT] Art. 29 lid 7 — purchase invoices >1 year past due and still unpaid, so the
  // voorbelasting deducted on them becomes payable AGAIN. This is the only art. 29 side that
  // costs money, and it grows belastingrente while nobody looks — so it is worded as a liability
  // and stands BEFORE the reclaim below. Still a RISK, never a blocking gap: "unpaid in our
  // records" is not proof of "unpaid in the world" (a bank that was never linked, cash at the
  // counter, a payment arrangement), and blocking a filing on an inference the app cannot verify
  // would trap the owner with no way out. So it names the amount and both ways to resolve it.
  if (s.vatClawback && s.vatClawback.repayableBtw >= BAD_DEBT_MIN_EUR && s.vatClawback.count > 0) {
    const n = s.vatClawback.count;
    risks.push({
      severity: "risk",
      title: `${telWoord(n, "onbetaalde inkoopfactuur")} >1 jaar — €${euro(s.vatClawback.repayableBtw)} voorbelasting terugbetalen`,
      detail:
        `${vervoeg(n, "Deze inkoopfactuur staat", "Deze inkoopfacturen staan")} meer dan een jaar na de vervaldatum open in je administratie. ` +
        "De BTW die je hierover in aftrek bracht wordt dan weer verschuldigd (art. 29 lid 7 Wet OB). " +
        "Heb je ze wél betaald? Koppel de bankbetaling of zet ze op betaald. Zo niet, dan hoort dit bedrag " +
        "terug in je aangifte — dit wordt NIET automatisch verrekend.",
      fix: { label: "Naar Inkoop", href: "/dashboard/incoming/manage" },
    });
  }

  // [BAD-DEBT] Sales invoices >1 year past due and still unpaid: the BTW you declared on them is
  // reclaimable (oninbare vordering, art. 29 Wet OB). Always a RISK, never a blocking gap — it is
  // money to get BACK, so it can never make an aangifte "too low", and whether/when to reclaim is
  // the owner's/accountant's call. Kasstelsel never reaches here (collector short-circuits to none).
  if (s.badDebt && s.badDebt.reclaimableBtw >= BAD_DEBT_MIN_EUR && s.badDebt.count > 0) {
    const n = s.badDebt.count;
    risks.push({
      severity: "risk",
      title: `${telWoord(n, "onbetaalde factuur")} >1 jaar — €${euro(s.badDebt.reclaimableBtw)} BTW terugvraagbaar`,
      detail:
        `${vervoeg(n, "Deze verkoopfactuur staat", "Deze verkoopfacturen staan")} meer dan een jaar na de vervaldatum open. De BTW die je hierover hebt afgedragen kun je terugvragen (oninbare vordering, art. 29 Wet OB). Dit wordt NIET automatisch verrekend — bespreek met je boekhouder in welk tijdvak je het terugvraagt.`,
      fix: FIX.facturen,
    });
  }

  // ── The score: weighted mean over APPLICABLE dimensions only (n.v.t. is excluded, never
  //    counted as 0 or as 100 — we don't inflate or punish for what we can't measure). ──
  const applicableWeight = dimensions.filter((d) => d.applicable).reduce((sum, d) => sum + d.weight, 0);
  const earned = dimensions.filter((d) => d.applicable).reduce((sum, d) => sum + d.weight * d.subscore, 0);
  let score = applicableWeight > 0 ? Math.round((100 * earned) / applicableWeight) : 0;
  // Honesty guard: never show a perfect 100% while anything still needs attention. A
  // single off-day among 90 rounds the reconciliation ratio to 100 — but if there is a
  // gap or a flagged risk, 100% would read as "nothing to check", which is false.
  if (score >= 100 && (missing.length > 0 || risks.length > 0)) score = 99;

  const isEmpty =
    s.verifiedInvoiceCount === 0 && s.bankTxCount === 0 && s.turnoverDays === 0 && !s.hasSales;
  if (isEmpty) {
    notes.push("Er zijn nog geen gegevens om te beoordelen — importeer facturen, bank of dagomzet.");
  }
  notes.push("Deze score meet alleen wat is geïmporteerd. Ontbreekt er een bron, dan is het beeld nog niet compleet.");

  // ── Status: 'ready' only when NOTHING is missing AND the score is high. Documented
  //    risks may remain (they travel to the accountant flagged) — but a gap never hides. ──
  const hasData = applicableWeight > 0;
  let status: ReadinessStatus;
  if (hasData && missing.length === 0 && score >= 90) status = "ready";
  else if (hasData && score >= 70) status = "almost";
  else status = "attention";

  return {
    quarterLabel: s.quarterLabel,
    score,
    status,
    ready: status === "ready",
    dimensions,
    missing,
    risks,
    notes,
  };
}

/** Human one-liner for a reconciliation break, in the owner's terms. */
function describeBreak(e: ReconException): string {
  const abs = Math.abs(euro(e.diff));
  if (e.kind === "pin") {
    return e.diff > 0
      ? `bank ontving €${abs} méér pin dan de kassa telde`
      : `bank ontving €${abs} minder pin dan de kassa telde`;
  }
  if (e.kind === "cash") {
    return e.diff > 0
      ? `€${abs} méér contant geteld dan de kassa aangaf`
      : `€${abs} minder contant geteld dan de kassa aangaf`;
  }
  if (e.kind === "internal") return `kassa telt intern €${abs} niet op`;
  return `€${abs} onverklaard verschil`;
}
