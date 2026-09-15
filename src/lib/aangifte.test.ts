// [AANGIFTE] Pure node test — run: npx tsx src/lib/aangifte.test.ts
// The headline case is PINNED to a REAL accountant filing: Kiwi Food Market, Btw-aangifte
// 1e kwartaal 2026. If the mapper reproduces that form line-for-line from the same
// numbers, the concept is trustworthy.
import { buildAangifte, buildAangifteCsv, euro, filedSaldo, privegebruikNote, type AangifteInput, type AangifteCompleteness } from "./aangifte";

let passed = 0, failed = 0;
function check(name: string, cond: boolean) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

const compl = (over: Partial<AangifteCompleteness> = {}): AangifteCompleteness => ({
  turnoverDays: 90, quarterDays: 90, incomingInvoiceCount: 40, outgoingInvoiceCount: 0, hasEuPurchase: false, ...over,
});

console.log("\n— REAL filing: Kiwi Food Market Q1 2026 —");
{
  // The sales side as the store's data produces it (turnover per rate), + the accountant's
  // documented voorbelasting. Figures verbatim from the aangifte PDF.
  const input: AangifteInput = {
    salesByRate: [
      { rate: 21, omzet: 1185, btw: 249 },
      { rate: 9, omzet: 176604, btw: 15894 },
      { rate: 0, omzet: 222, btw: 0 },
    ],
    btwVoorbelasting: 15130,
    cashOmzetZonderBtw: 0,
  };
  const a = buildAangifte(input, compl(), "Q1 2026");
  const row = (c: string) => a.rows.find((r) => r.code === c)!;
  check("1a (21%): omzet 1.185 / btw 249", row("1a").omzet === 1185 && row("1a").btw === 249);
  check("1b (9%): omzet 176.604 / btw 15.894", row("1b").omzet === 176604 && row("1b").btw === 15894);
  check("1e (0%): omzet 222, geen btw", row("1e").omzet === 222 && row("1e").btw === 0);
  check("5a verschuldigd = 16.143 (= 249 + 15.894)", a.verschuldigd === 16143);
  check("5b voorbelasting = 15.130", a.voorbelasting === 15130);
  check("5g te betalen = 1.013 (matches the accountant EXACTLY)", a.saldo === 1013);
  check("marked as a concept", a.isConcept === true);
}

console.log("\n— whole-euro rounding like the form —");
{
  const input: AangifteInput = { salesByRate: [{ rate: 9, omzet: 999.4, btw: 89.95 }], btwVoorbelasting: 10.4, cashOmzetZonderBtw: 0 };
  const a = buildAangifte(input, compl(), "Q2 2026");
  check("1b btw rounds 89.95 -> 90", a.rows.find((r) => r.code === "1b")!.btw === 90);
  check("5a = sum of rounded rubrieken (90)", a.verschuldigd === 90);
  check("5g = 90 - 10 = 80", a.saldo === 80);
}

console.log("\n— other rate -> 1c, never silently merged into 1a/1b —");
{
  const input: AangifteInput = { salesByRate: [{ rate: 13, omzet: 100, btw: 13 }], btwVoorbelasting: 0, cashOmzetZonderBtw: 0 };
  const a = buildAangifte(input, compl(), "Q1 2026");
  check("a 13% sale surfaces as 1c", a.rows.some((r) => r.code === "1c" && r.btw === 13));
}

console.log("\n— honest notes: no false reassurance —");
{
  const base: AangifteInput = { salesByRate: [{ rate: 9, omzet: 1000, btw: 90 }], btwVoorbelasting: 50, cashOmzetZonderBtw: 0 };
  const always = buildAangifte(base, compl(), "Q1 2026").notes.join(" ");
  check("always states it's a concept, not a filing", /CONCEPT/.test(always) && /geen ingediende aangifte/.test(always));
  check("always states 5b depends on all purchase invoices", /Ontbreekt er een inkoopfactuur/.test(always));

  const partial = buildAangifte(base, compl({ turnoverDays: 40, quarterDays: 90 }), "Q1 2026").notes.join(" ");
  check("flags missing kassadagen when coverage is partial", /40 kassadagen/.test(partial) && /Ontbrekende dagen/.test(partial));

  const eu = buildAangifte(base, compl({ hasEuPurchase: true }), "Q1 2026").notes.join(" ");
  check("flags EU purchases / rubriek 4b not auto-computed", /rubriek 4b/.test(eu));

  const noRate = buildAangifte({ ...base, cashOmzetZonderBtw: 250 }, compl(), "Q1 2026").notes.join(" ");
  check("flags omzet without a rate (not slotted into 1a/1b)", /250 omzet heeft nog geen BTW-tarief/.test(noRate));

  // [DATELESS] verified invoices with no date are dropped by the range fetch → must warn.
  const dateless = buildAangifte(base, compl({ datelessVerifiedCount: 2 }), "Q1 2026").notes.join(" ");
  check("flags dateless verified invoices (silently dropped otherwise)", /2 geverifieerde/.test(dateless) && /geen factuurdatum/.test(dateless));
  const noDateless = buildAangifte(base, compl(), "Q1 2026").notes.join(" ");
  check("no dateless note when count is 0/undefined", !/geen factuurdatum/.test(noDateless));
}

console.log("\n— AUDIT FIX: a 0-rate bucket carrying BTW is surfaced (1c), never silently zeroed —");
{
  // An undecidable/mis-derived rate can leave BTW in the rate-0 bucket; buildAangifte must
  // NOT drop it into 1e (which forces btw:0). It belongs in 1c so it stays visible.
  const a = buildAangifte(
    { salesByRate: [{ rate: 0, omzet: -1185, btw: -249 }], btwVoorbelasting: 0, cashOmzetZonderBtw: 0 },
    compl(), "Q1 2026",
  );
  check("rate-0 WITH btw lands in 1c, not silently in 1e", a.rows.some((r) => r.code === "1c" && Math.round(r.btw) === -249));
  check("5a reflects it (the BTW is not lost)", a.verschuldigd === -249);
  check("a genuine 0% row (btw 0) still maps to 1e", buildAangifte({ salesByRate: [{ rate: 0, omzet: 222, btw: 0 }], btwVoorbelasting: 0, cashOmzetZonderBtw: 0 }, compl(), "Q1 2026").rows.some((r) => r.code === "1e" && r.omzet === 222));
}

console.log("\n— buildAangifteCsv: the concept as a traceable CSV for the closing package —");
{
  // The REAL Kiwi Q1 filing → the CSV the accountant opens next to the evidence.
  const a = buildAangifte(
    {
      salesByRate: [
        { rate: 21, omzet: 1185, btw: 249 },
        { rate: 9, omzet: 176604, btw: 15894 },
        { rate: 0, omzet: 222, btw: 0 },
      ],
      btwVoorbelasting: 15130,
      cashOmzetZonderBtw: 0,
    },
    compl(),
    "Q1 2026",
  );
  const csv = buildAangifteCsv(a);
  const lines = csv.split("\r\n");
  check("uses CRLF + semicolons (Excel-NL)", csv.includes("\r\n") && csv.includes(";"));
  check("headed as a CONCEPT, not a filing", /GEEN ingediende aangifte/.test(csv) && /Concept BTW-aangifte Q1 2026/.test(csv));
  check("1a row carries omzet 1185,00 and btw 249,00 (comma decimals)", lines.some((l) => l.startsWith("1a;") && l.includes("1185,00") && l.includes("249,00")));
  check("1b row carries the 9% bucket", lines.some((l) => l.startsWith("1b;") && l.includes("176604,00") && l.includes("15894,00")));
  check("1e row present with empty btw cell", lines.some((l) => l.startsWith("1e;") && /;222,00;$/.test(l)));
  check("5a = 16143,00", lines.some((l) => l.startsWith("5a;") && l.includes("16143,00")));
  check("5b = 15130,00", lines.some((l) => l.startsWith("5b;") && l.includes("15130,00")));
  check("5g labelled 'te betalen' with 1013,00 (abs, never negative-signed)", lines.some((l) => l.startsWith("5g;") && /te betalen/.test(l) && l.includes("1013,00")));
  check("carries the honest notes (source for every figure)", /Waar dit op gebaseerd is/.test(csv) && /Voorbelasting \(5b\) telt/.test(csv));
}

console.log("\n— buildAangifteCsv: a refund quarter shows 'terug te ontvangen', abs value —");
{
  const a = buildAangifte(
    { salesByRate: [{ rate: 9, omzet: 1000, btw: 90 }], btwVoorbelasting: 300, cashOmzetZonderBtw: 0 },
    compl(), "Q2 2026",
  );
  const csv = buildAangifteCsv(a);
  check("5g labelled 'terug te ontvangen'", /5g;Concept terug te ontvangen;;210,00/.test(csv));
  check("saldo itself stays signed (−210) in the object", a.saldo === -210);
}

console.log("\n— [ICP] rubriek 3b: stated correctly, and it can never change what you pay —");
{
  const sales: AangifteInput["salesByRate"] = [
    { rate: 21, omzet: 5000, btw: 1050 },
    { rate: 0, omzet: 3000, btw: 0 },
  ];
  const zonder = buildAangifte({ salesByRate: sales, btwVoorbelasting: 200, cashOmzetZonderBtw: 0 }, compl(), "Q3 2026");
  const met = buildAangifte({ salesByRate: sales, btwVoorbelasting: 200, cashOmzetZonderBtw: 0, intraEuOmzet: 1200 }, compl(), "Q3 2026");

  check("without intra-EU turnover all 0% stays in 1e",
    zonder.rows.some((r) => r.code === "1e" && r.omzet === 3000) && !zonder.rows.some((r) => r.code === "3b"));
  check("intra-EU turnover appears as its own rubriek 3b",
    met.rows.some((r) => r.code === "3b" && r.omzet === 1200));
  check("…and it LEAVES 1e, so it is never stated twice",
    met.rows.some((r) => r.code === "1e" && r.omzet === 1800));
  check("THE SAFETY PROPERTY: 5a is untouched", met.verschuldigd === zonder.verschuldigd);
  check("…and so is 5b", met.voorbelasting === zonder.voorbelasting);
  check("…and so is what the owner actually pays (5g)", met.saldo === zonder.saldo);
  check("3b carries no BTW of its own", met.rows.find((r) => r.code === "3b")!.btw === 0);

  const all = buildAangifte({ salesByRate: sales, btwVoorbelasting: 0, cashOmzetZonderBtw: 0, intraEuOmzet: 3000 }, compl(), "Q3 2026");
  check("when ALL the 0% is intra-EU, 1e disappears rather than showing €0",
    all.rows.some((r) => r.code === "3b" && r.omzet === 3000) && !all.rows.some((r) => r.code === "1e"));

  // A mismatch between the two sources must never invent turnover or drive 1e negative.
  const over = buildAangifte({ salesByRate: sales, btwVoorbelasting: 0, cashOmzetZonderBtw: 0, intraEuOmzet: 9999 }, compl(), "Q3 2026");
  check("more intra-EU than there is 0%-turnover is capped, never invented",
    over.rows.find((r) => r.code === "3b")!.omzet === 3000);
  check("…and 1e can never go negative", !over.rows.some((r) => r.code === "1e" && r.omzet < 0));

  // A quarter whose EU turnover nets NEGATIVE (a creditnota for a sale invoiced earlier) has a
  // genuinely negative 3b. Clamping it to zero would leave the credit in 1e while the ICP-opgaaf
  // beside it reports the negative — two documents for one accountant, contradicting each other.
  const negSales: AangifteInput["salesByRate"] = [
    { rate: 21, omzet: 5000, btw: 1050 },
    { rate: 0, omzet: -800, btw: 0 },
  ];
  const neg = buildAangifte({ salesByRate: negSales, btwVoorbelasting: 0, cashOmzetZonderBtw: 0, intraEuOmzet: -500 }, compl(), "Q3 2026");
  check("a net-negative EU quarter gets a negative 3b, not a hidden one",
    neg.rows.find((r) => r.code === "3b")!.omzet === -500);
  check("…and the rest of the negative 0%-bucket stays in 1e",
    neg.rows.find((r) => r.code === "1e")!.omzet === -300);
  check("…while 5g still does not move",
    neg.saldo === buildAangifte({ salesByRate: negSales, btwVoorbelasting: 0, cashOmzetZonderBtw: 0 }, compl(), "Q3 2026").saldo);
  const negCapped = buildAangifte({ salesByRate: negSales, btwVoorbelasting: 0, cashOmzetZonderBtw: 0, intraEuOmzet: -9999 }, compl(), "Q3 2026");
  check("a negative bigger than the bucket is capped too, and 1e never flips sign",
    negCapped.rows.find((r) => r.code === "3b")!.omzet === -800 && !negCapped.rows.some((r) => r.code === "1e"));

  // Mixed signs are not an amount anyone can honestly move.
  check("positive EU turnover against a negative 0%-bucket moves nothing",
    buildAangifte({ salesByRate: negSales, btwVoorbelasting: 0, cashOmzetZonderBtw: 0, intraEuOmzet: 500 }, compl(), "Q3 2026")
      .rows.find((r) => r.code === "1e")!.omzet === -800);
  check("…and neither does the reverse",
    buildAangifte({ salesByRate: sales, btwVoorbelasting: 0, cashOmzetZonderBtw: 0, intraEuOmzet: -500 }, compl(), "Q3 2026")
      .rows.find((r) => r.code === "1e")!.omzet === 3000);

  // When 3b could not take the whole figure, the concept and the ICP-opgaaf beside it disagree —
  // and both go to the same accountant, so the difference is stated instead of discovered.
  const capped = buildAangifte({ salesByRate: sales, btwVoorbelasting: 0, cashOmzetZonderBtw: 0, intraEuOmzet: 9999 }, compl(), "Q3 2026");
  check("a capped 3b says so, naming both amounts",
    capped.notes.some((n) => /intracommunautaire leveringen/.test(n) && /9\.999/.test(n) && /3\.000/.test(n)));
  check("…and points at the two likely causes", capped.notes.some((n) => /tóch BTW is berekend/.test(n) && /creditnota/.test(n)));
  check("…and warns that the two figures get compared", capped.notes.some((n) => /naast elkaar gelegd/.test(n)));
  check("a 3b that took the whole figure says nothing extra",
    !met.notes.some((n) => /naast elkaar gelegd/.test(n)));
  check("no intra-EU turnover at all says nothing either",
    !zonder.notes.some((n) => /naast elkaar gelegd/.test(n)));

  check("the CSV carries 3b with its Belastingdienst label",
    /3b;Leveringen naar landen binnen de EU;1200,00/.test(buildAangifteCsv(met)));
}

console.log("\n— [COUNT-BASIS] de tellingen beschrijven de set waar de cijfers uit komen —");
{
  const input: AangifteInput = {
    salesByRate: [{ rate: 21, omzet: 1000, btw: 210 }],
    btwVoorbelasting: 100,
    cashOmzetZonderBtw: 0,
  };
  const note = (a: ReturnType<typeof buildAangifte>, re: RegExp) => a.notes.find((n) => re.test(n)) ?? "";

  // Factuurstelsel: onveranderd. Dit is de bestaande zin, woord voor woord.
  const acc = buildAangifte(input, compl({ incomingInvoiceCount: 40, outgoingInvoiceCount: 3 }), "Q1 2026");
  check("factuur: 5b noemt 'ingevoerde inkoopfacturen'",
    /Voorbelasting \(5b\) telt alleen 40 ingevoerde inkoopfactu/.test(note(acc, /Voorbelasting/)));
  // [MEERVOUD] De zin is hier hetzelfde gebleven; alleen de SPELLING is gerepareerd — hij zei
  // "3 verkoopfactu(u)r(en)". Wat deze regel bewaakt is het ontbreken van het betaal-woord in het
  // factuurstelsel, en dat wordt hieronder apart gecontroleerd zodat een volgende herformulering
  // niet ongemerkt "betaalde" kan terugbrengen.
  check("factuur: 5a noemt de verkoopfacturen zonder betaal-woord",
    /en 3 verkoopfacturen\./.test(note(acc, /Verkoop-BTW/)) &&
    !/betaalde/.test(note(acc, /Verkoop-BTW/)));

  // Kasstelsel: dezelfde getallen betekenen iets anders, en de zin zegt dat nu ook.
  const cash = buildAangifte(input, compl({ incomingInvoiceCount: 10, outgoingInvoiceCount: 3, scheme: "kas" }), "Q1 2026");
  // [KAS-VOORBELASTING] 5b is dated by the purchase invoice on BOTH schemes, so the sentence that
  // said "die je hebt BETAALD" described a rule the Belastingdienst does not have. What the kas
  // owner does get is the one line that says the two sides are dated differently.
  check("kas: 5b noemt dezelfde ingevoerde inkoopfacturen als het factuurstelsel",
    /Voorbelasting \(5b\) telt alleen 10 ingevoerde inkoopfactu/.test(note(cash, /Voorbelasting/)));
  check("kas: 5b zegt nergens meer dat je hem eerst moet betalen",
    !/BETAALD \(kasstelsel\)/.test(note(cash, /Voorbelasting/)));
  check("kas: de aangifte legt uit dat alleen de omzet-BTW verschuift",
    /alleen de BTW over je omzet naar de betaaldatum/.test(note(cash, /kasstelsel verschuift/)) &&
    /voorbelasting trek je af in het kwartaal van de inkoopfactuur/.test(note(cash, /kasstelsel verschuift/)));
  check("factuur: die uitleg staat er niet — er verschuift niets",
    !acc.notes.some((n) => /kasstelsel verschuift/.test(n)));
  check("kas: 5a noemt de betaalde verkoopfacturen",
    /3 in dit kwartaal betaalde verkoopfactu/.test(note(cash, /Verkoop-BTW/)));
  check("kas verandert geen enkel BEDRAG — alleen de zin",
    cash.verschuldigd === acc.verschuldigd && cash.voorbelasting === acc.voorbelasting && cash.saldo === acc.saldo);

  // Zonder verkoopfacturen blijft de zin in beide stelsels bij de dagomzet.
  const geen = buildAangifte(input, compl({ outgoingInvoiceCount: 0, scheme: "kas" }), "Q1 2026");
  check("geen verkoopfacturen: geen losse bijzin, in geen van beide stelsels",
    /uit 90 dagen dagomzet\./.test(note(geen, /Verkoop-BTW/)));
}

console.log("\n— [PRIVEGEBRUIK] rubriek 1d: de correctie die deze app niet kan berekenen —");
{
  // Leaving 1d out means declaring too LITTLE BTW. That surfaces as a naheffing with
  // belastingrente months later, never as an error on screen. The app cannot compute it (it does
  // not know a vehicle's catalogue value or anyone's private kilometres), so the only honest move
  // is to say so — while the owner can still act on it.
  const q4 = privegebruikNote(4);
  check("Q4 says the correction belongs in THIS filing", /DEZE aangifte/.test(q4));
  check("Q4 names the rubriek", /1d/.test(q4));
  check("Q4 never implies the app computed it", /NIET berekend/.test(q4));

  // The whole reason this is said before Q4: a kilometre administration cannot be reconstructed
  // in January. A note that appears only in the last quarter arrives too late to act on.
  let earlyOk = true, earlyActionable = true;
  for (const q of [1, 2, 3] as const) {
    const n = privegebruikNote(q);
    if (!/LAATSTE aangifte van het jaar/.test(n)) earlyOk = false;
    if (!/NU bijhoudt|kilometeradministratie/.test(n)) earlyActionable = false;
  }
  check("Q1-Q3 say when the correction lands", earlyOk);
  check("Q1-Q3 say what to do TODAY — the records, not the filing", earlyActionable);

  // Same discipline as rubriek 4b: state what is NOT computed rather than guessing. A fabricated
  // 1d would be worse than none — it would look settled.
  let noAmount = true, allPresent = true;
  for (const q of [1, 2, 3, 4] as const) {
    if (/€/.test(privegebruikNote(q))) noAmount = false;
    if (privegebruikNote(q).length < 40) allPresent = false;
  }
  check("the note never carries an amount", noAmount);
  check("every quarter gets a note — the rubriek exists all year", allPresent);
}


console.log("\n— [VRIJGESTELD] exempt turnover: named, in no rubriek, and never called 'no turnover' —");
{
  // A fully exempt practice: EUR 132.000 of care turnover, nothing taxed, no till days.
  const input: AangifteInput = {
    salesByRate: [],
    btwVoorbelasting: 0,
    cashOmzetZonderBtw: 0,
    vrijgesteldeOmzet: 132000,
    proRataPercent: 0,
    voorbelastingGeblokkeerd: 4200,
  };
  const a = buildAangifte(input, compl({ turnoverDays: 0 }), "Q3 2026");
  const notes = a.notes.join(" | ");

  check("the figure is carried out, not dropped", a.vrijgesteldeOmzet === 132000);
  check("it reaches NO rubriek — not even 1e", !a.rows.some((r) => r.omzet === 132000));
  check("5a stays empty (an exemption charges no BTW)", a.verschuldigd === 0);
  // The defect this pins: the sentence is keyed on salesByRate being empty, and for a fully
  // exempt owner it always is. Told "je hebt nog geen omzet ingevoerd" at the moment their
  // quarter is complete, an owner reasonably concludes the app lost their invoices.
  check("it does NOT claim the quarter is empty", !/nog geen omzet ingevoerd/.test(notes));
  check("the exempt turnover is named in the notes", /VRIJGESTELD/.test(notes) && /132\.000/.test(notes));
  check("and the note says why it is in no box", /geen[\s\S]*rubriek/.test(notes));
  check("blocked input BTW is disclosed", /4\.200/.test(notes) && /geen recht op aftrek/.test(notes));
}

console.log("\n— [VRIJGESTELD] blocked input BTW is disclosed in a quarter with no exempt turnover —");
{
  // A physio buys a EUR 3.000 treatment table in January and treats their first patient in April.
  // Q1 has EUR 630 withheld from 5b and no exempt turnover to pair it with. The sentence explaining
  // why 5b is EUR 630 lower than the purchase invoices say used to sit INSIDE the exempt-turnover
  // block, so in exactly this quarter it did not appear: the figure was right and read like a bug.
  const a = buildAangifte(
    {
      salesByRate: [{ rate: 21, omzet: 2000, btw: 420 }],
      btwVoorbelasting: 0,
      cashOmzetZonderBtw: 0,
      vrijgesteldeOmzet: 0,
      voorbelastingGeblokkeerd: 630,
      exemptRegime: true,
    },
    compl(), "Q1 2026",
  );
  const notes = a.notes.join(" | ");
  check("the blocked BTW is named even with zero exempt turnover", /630/.test(notes) && /geen recht op aftrek/.test(notes));
  check("and no exempt-turnover sentence is invented alongside it", !/van je omzet is VRIJGESTELD/.test(notes));

  // The rounding trap that made it worse: 40 cents of exempt turnover rounds to 0 in the sentence
  // above, and used to take the blocked-BTW note down with it.
  const cents = buildAangifte(
    {
      salesByRate: [], btwVoorbelasting: 0, cashOmzetZonderBtw: 0,
      vrijgesteldeOmzet: 0.4, voorbelastingGeblokkeerd: 630, exemptRegime: true,
    },
    compl(), "Q1 2026",
  );
  check("cent-sized exempt turnover no longer hides the blocked BTW", /630/.test(cents.notes.join(" | ")));

  // And an owner with no blocked BTW at all is told nothing — the note is a disclosure, not decor.
  const none = buildAangifte(
    { salesByRate: [], btwVoorbelasting: 100, cashOmzetZonderBtw: 0 },
    compl(), "Q1 2026",
  );
  check("no blocked BTW → no sentence about it", !/geen recht op aftrek/.test(none.notes.join(" | ")));
}

console.log("\n— [VRIJGESTELD] a genuinely empty quarter still says so —");
{
  const a = buildAangifte(
    { salesByRate: [], btwVoorbelasting: 0, cashOmzetZonderBtw: 0, vrijgesteldeOmzet: 0 },
    compl({ turnoverDays: 0 }),
    "Q3 2026",
  );
  check("no exempt turnover ⇒ the empty-quarter sentence is back", /nog geen omzet ingevoerd/.test(a.notes.join(" | ")));
  check("and no exemption note is invented", !/VRIJGESTELD/.test(a.notes.join(" | ")));
}

console.log("\n— [VRIJGESTELD] an undecidable ratio says 5b is deliberately too LOW —");
{
  const a = buildAangifte(
    {
      salesByRate: [], btwVoorbelasting: 105, cashOmzetZonderBtw: 0,
      vrijgesteldeOmzet: 0, proRataPercent: null, voorbelastingUnresolved: 210,
    },
    compl({ turnoverDays: 0 }),
    "Q3 2026",
  );
  const notes = a.notes.join(" | ");
  check("the unresolved BTW is named", /210/.test(notes));
  check("and the direction of the error is stated, not implied", /te LAAG/.test(notes));
  check("5b carries only what was actually claimable", a.voorbelasting === 105);
}

console.log("\n— [TEGENTEKEN] BTW left out because the document contradicts itself —");
{
  const a = buildAangifte(
    {
      salesByRate: [], btwVoorbelasting: 84, cashOmzetZonderBtw: 0,
      vrijgesteldeOmzet: 0, proRataPercent: null, voorbelastingUnresolved: 0,
      voorbelastingTegenteken: 13,
    },
    compl({ turnoverDays: 0 }),
    "Q1 2026",
  );
  const notes = a.notes.join(" | ");
  check("the refused amount is named", /13/.test(notes));
  check("and WHY it cannot be right, in words the owner can act on", /tegengesteld teken/.test(notes));
  check("5b carries only what was actually claimable", a.voorbelasting === 84);

  // The DIRECTION must not be claimed, and this is the correction that matters most in this note.
  // The sibling note above says "bewust te LAAG" and is right to: there an ordinary deduction falls
  // away. Here the amount that fell away may be a CREDITNOTA, which would have LOWERED 5b — so
  // leaving it out makes 5b too HIGH. Which of the two it is, is exactly what this document does
  // not say, and an accountant reads a stated direction as a fact and reckons with it.
  check("no direction is claimed that the document cannot support", !/te LAAG/.test(notes) && !/te HOOG/.test(notes));
  check("…and both possibilities are spelled out instead", /AF/.test(notes) && /ERBIJ/.test(notes));

  // [NEGATIEVE CONTROLE] The note must be absent on an ordinary quarter, or it becomes wallpaper
  // that an accountant learns to scroll past — and this one fires on one document in five hundred.
  const gewoon = buildAangifte(
    {
      salesByRate: [], btwVoorbelasting: 84, cashOmzetZonderBtw: 0,
      vrijgesteldeOmzet: 0, proRataPercent: null, voorbelastingUnresolved: 0,
      voorbelastingTegenteken: 0,
    },
    compl({ turnoverDays: 0 }),
    "Q1 2026",
  );
  check("no note when nothing was refused", !/tegengesteld teken/.test(gewoon.notes.join(" | ")));
}


console.log("\n— [VRIJGESTELD] the boundary of the feature is stated in the concept, not only in a migration —");
{
  // A physio: EUR 40.000 exempt care invoiced, plus EUR 9.000 through the till and the cash book
  // that this round cannot classify and therefore booked as TAXED.
  const a = buildAangifte(
    {
      salesByRate: [{ rate: 21, omzet: 9000, btw: 1890 }],
      btwVoorbelasting: 0, cashOmzetZonderBtw: 0,
      vrijgesteldeOmzet: 40000, proRataPercent: 19,
      onclassificeerbareOmzet: 9000, exemptRegime: true,
    },
    compl({ turnoverDays: 90 }),
    "Q3 2026",
  );
  const notes = a.notes.join(" | ");
  check("the unclassifiable turnover is named with its amount", /9\.000/.test(notes));
  check("and it says which way the error runs (counted as TAXED)", /BELASTE omzet/.test(notes));
  check("and where the owner CAN classify instead", /per regel/.test(notes));
  // The figure itself is still declared — the limit is about the LABEL, not about hiding money.
  check("the taxed bucket keeps its BTW", a.rows.find((r) => r.code === "1a")!.btw === 1890);
}

console.log("\n— [VRIJGESTELD] an invoice-only exempt owner is not warned about a till they don't have —");
{
  const a = buildAangifte(
    {
      salesByRate: [], btwVoorbelasting: 0, cashOmzetZonderBtw: 0,
      vrijgesteldeOmzet: 132000, proRataPercent: 0,
      onclassificeerbareOmzet: 0, exemptRegime: true,
    },
    compl({ turnoverDays: 0 }),
    "Q3 2026",
  );
  check("no till/cash warning when there is no till or cash", !/dagomzet \(kassa\)/.test(a.notes.join(" | ")));
}

console.log("\n— [VRIJGESTELD] and an ordinary owner with a till is never warned at all —");
{
  const a = buildAangifte(
    {
      salesByRate: [{ rate: 21, omzet: 9000, btw: 1890 }],
      btwVoorbelasting: 0, cashOmzetZonderBtw: 0,
      onclassificeerbareOmzet: 0, exemptRegime: false,
    },
    compl({ turnoverDays: 90 }),
    "Q3 2026",
  );
  const notes = a.notes.join(" | ");
  check("off-regime: no exemption sentence of any kind", !/vrijgesteld/i.test(notes));
}

// ── [AFRONDING] Whole euros, symmetrically around zero ───────────────────────
//
// Math.round breaks ties toward +infinity, so 1,50 becomes 2 but -1,50 becomes -1. Invisible on a
// normal quarter, where every rubriek is positive. It appears on a quarter that nets NEGATIVE — a
// large creditnota, a refunded season, a correction from an earlier period — which is exactly the
// quarter that is already unusual and least likely to be double-checked. There the bias ran one
// way every time: toward zero, which on a reclaim is against the owner.
console.log("\n— [AFRONDING] hele euro's, symmetrisch rond nul —");
{
  const neg = buildAangifte(
    { salesByRate: [{ rate: 21, omzet: -1000.5, btw: -210.5 }], btwVoorbelasting: 0, cashOmzetZonderBtw: 0 },
    compl(), "Q3 2026",
  );
  const n1a = neg.rows.find((r) => r.code === "1a")!;
  check("-210,50 wordt -211, niet -210", n1a.btw === -211);
  check("-1000,50 wordt -1001, niet -1000", n1a.omzet === -1001);

  // De positieve kant mag NIET bewegen: deze correctie hoort een gewoon kwartaal niet te raken.
  const pos = buildAangifte(
    { salesByRate: [{ rate: 21, omzet: 1000.5, btw: 210.5 }], btwVoorbelasting: 0, cashOmzetZonderBtw: 0 },
    compl(), "Q3 2026",
  );
  const p1a = pos.rows.find((r) => r.code === "1a")!;
  check("210,50 blijft 211", p1a.btw === 211);
  check("1000,50 blijft 1001", p1a.omzet === 1001);

  // JavaScript houdt -0 en 0 uit elkaar, en een "-0" op een concept dat een boekhouder leest is
  // een vraag die niemand hoort te hoeven stellen.
  const nul = buildAangifte(
    { salesByRate: [{ rate: 21, omzet: -0.4, btw: -0.2 }], btwVoorbelasting: 0, cashOmzetZonderBtw: 0 },
    compl(), "Q3 2026",
  );
  const z1a = nul.rows.find((r) => r.code === "1a")!;
  check("een rubriek staat nooit als -0", Object.is(z1a.btw, 0) && Object.is(z1a.omzet, 0));

  // 5b en 5g lopen door dezelfde afronding — een teruggaaf hoort net zo symmetrisch te zijn.
  const teruggaaf = buildAangifte(
    { salesByRate: [], btwVoorbelasting: 210.5, cashOmzetZonderBtw: 0 },
    compl(), "Q3 2026",
  );
  check("voorbelasting 210,50 wordt 211", teruggaaf.voorbelasting === 211);
  check("en het saldo is dan -211", teruggaaf.saldo === -211);
}

console.log("\n— [SUPPLETIE-FANTOOM] the two roundings that produced a phantom correction —");
{
  // The concept's 5a is the SUM of the per-rubriek rounded amounts, because that is what the paper
  // form asks for. The filing snapshot stores the engine's raw total, and the screen rounded that
  // ONCE. Those are different operations, and on a quarter nobody touched they disagreed — so the
  // owner read that "€ 1 komt erbij" on a return he had already filed: a suppletie prompt for a
  // difference that existed only in the rounding, on the screen where a figure has to be trusted.
  //
  // (The other half of the same defect — Math.round against euro() on a negative quarter — is
  // pinned by the [AFRONDING] block above; the filed snapshot now uses euro() too.)
  const input: AangifteInput = {
    salesByRate: [
      { rate: 21, omzet: 1000, btw: 100.5 },   // → 101 on its own line
      { rate: 9, omzet: 1000, btw: 200.5 },    // → 201 on its own line
    ],
    btwVoorbelasting: 0,
    cashOmzetZonderBtw: 0,
  };
  const a = buildAangifte(input, compl(), "Q3 2026");
  const rawTotal = 100.5 + 200.5;              // 301 exactly — what the engine hands the filing

  check("5a is the sum of the rounded rubrieken (101 + 201)", a.verschuldigd === 302);
  check("rounding the raw total once gives 301 instead", euro(rawTotal) === 301);
  check("so subtracting the two DISPLAYS invents a euro out of nothing", a.verschuldigd - euro(rawTotal) === 1);
  // The comparison that is actually correct, and what the route now returns as saldoDelta — the
  // same raw-against-raw that computeFilingDivergence has always used for the real suppletie.
  check("raw against raw is zero on an unchanged quarter", euro(rawTotal - rawTotal) === 0);
}

console.log("\n— [SUPPLETIE-FANTOOM] het saldo van een INGEDIENDE momentopname —");
{
  // 5g is 5a min 5b, elk afzonderlijk afgerond — dat is wat op het formulier staat en wat de
  // eigenaar indient. Twee lezers van de opgeslagen momentopname deden het allebei anders, en
  // allebei op hun eigen manier fout: /api/btw-reservation rondde het RUWE verschil in één keer af
  // en reserveerde € 800 voor een aangifte die zojuist voor € 801 was ingediend; /api/aangifte
  // toonde 1001 en 200 naast een saldo van 800 — drie getallen waarvan er twee de derde
  // tegenspreken.
  check("verschuldigd 1000,60 en voorbelasting 200,40 geven 801, niet 800",
    filedSaldo({ btw_verschuldigd: 1000.6, btw_voorbelasting: 200.4, btw_saldo: 800.2 }) === 801);
  check("…en Math.round op het ruwe saldo gaf echt 800 (anders is het voorbeeld zijn punt kwijt)",
    Math.round(800.2) === 800);

  // De hele reden dat dit één functie is: de ingediende en de nog-niet-ingediende tak van
  // /api/btw-reservation vullen ÉÉN lijst en tellen op tot het bedrag dat opzij moet. Rekenen ze
  // anders, dan verandert dat bedrag zodra de eigenaar "markeer als ingediend" tikt.
  const zelfde = ([[1000.6, 200.4], [0.5, 0], [100.5, 300.5], [0, 0], [-100.4, 50.6]] as const)
    .every(([v, vb]) => filedSaldo({ btw_verschuldigd: v, btw_voorbelasting: vb, btw_saldo: v - vb }) === euro(v) - euro(vb));
  check("ingediend en concept geven hetzelfde getal op dezelfde cijfers", zelfde);

  // euro() rondt van nul áf, Math.round breekt gelijkspel naar +∞. Op een teruggavekwartaal gaven
  // twee getallen op één scherm daardoor een ander antwoord over dezelfde halve euro.
  check("een teruggavekwartaal rondt van nul af, niet naar boven",
    filedSaldo({ btw_verschuldigd: 100, btw_voorbelasting: 100.5, btw_saldo: -0.5 }) === -1 && Object.is(Math.round(-0.5), -0));

  // De momentopname heeft de twee kolommen niet altijd gehad. Terugvallen is beter dan nul.
  check("een oudere rij zonder componenten valt terug op het ruwe saldo",
    filedSaldo({ btw_saldo: 800.2 }) === 800
    && filedSaldo({ btw_saldo: 800.2, btw_verschuldigd: null, btw_voorbelasting: null }) === 800
    && filedSaldo({}) === 0);
}

// ── [RUBRIEK-1E] Het juiste bedrag in het verkeerde vakje ────────────────────────────────────
//
// Het formulier heeft drie vakken voor omzet zonder Nederlandse BTW, en ze zijn niet
// uitwisselbaar: 1e (binnenlands 0% en verlegd), 3a (uitvoer buiten de EU) en 3c (installatie- en
// afstandsverkopen binnen de EU). Dit concept kent er maar één van de drie, dus een export naar
// een klant in Londen belandt in 1e. De TOTALEN kloppen — alle drie dragen € 0 BTW, dus 5a en 5g
// bewegen geen cent — en de aangifte is toch onjuist: er staat binnenlandse 0%-omzet waar uitvoer
// hoorde te staan.
//
// Splitsen doet het concept nog niet — het land van de klant is er sinds [KLANT-LAND], het soort
// levering niet. Dus zegt hij het.
console.log("\n[RUBRIEK-1E] wat er in 1e staat, en wat de app er niet uit kan halen");
{
  const met1e = buildAangifte(
    { salesByRate: [{ rate: 21, omzet: 1000, btw: 210 }, { rate: 0, omzet: 5000, btw: 0 }], btwVoorbelasting: 0, cashOmzetZonderBtw: 0 },
    compl(), "Q1 2026",
  );
  const zin = met1e.notes.find((n) => n.includes("rubriek 1e"));
  check("er staat een notitie over 1e", !!zin);
  check("…met het bedrag erin", !!zin && /5\.000/.test(zin));
  check("…die 3a noemt voor buiten de EU", !!zin && /3a \(uitvoer\)/.test(zin));
  check("…en 3c voor afstandsverkopen", !!zin && /3c/.test(zin));
  check("…en dat het concept 3a/3c nog niet zelf uitrekent", !!zin && /Rubriek 3a en 3c rekent dit concept nog niet uit/.test(zin));

  // De cijfers mogen door deze notitie niet bewegen. Dat is de hele veiligheid ervan.
  check("5a blijft de BTW van 1a", met1e.verschuldigd === 210);
  check("1e houdt zijn eigen bedrag", met1e.rows.find((r) => r.code === "1e")?.omzet === 5000);
  check("…en nul BTW", met1e.rows.find((r) => r.code === "1e")?.btw === 0);

  // Geen 1e-omzet, geen notitie. Een aangifte die elke ondernemer over uitvoer aanspreekt terwijl
  // hij alleen in Tilburg verkoopt, is een aangifte waarvan de notities niet meer gelezen worden.
  const zonder1e = buildAangifte(
    { salesByRate: [{ rate: 21, omzet: 1000, btw: 210 }], btwVoorbelasting: 0, cashOmzetZonderBtw: 0 },
    compl(), "Q1 2026",
  );
  check("zonder 0%-omzet zwijgt de notitie", !zonder1e.notes.some((n) => n.includes("rubriek 1e")));

  // Wat naar 3b is verhuisd, staat niet meer in 1e — en als er niets overblijft, is er ook niets
  // te melden: dan is de rubriek al goed.
  const alles3b = buildAangifte(
    { salesByRate: [{ rate: 0, omzet: 5000, btw: 0 }], intraEuOmzet: 5000, btwVoorbelasting: 0, cashOmzetZonderBtw: 0 },
    compl(), "Q1 2026",
  );
  check("volledig intra-EU ⇒ geen 1e-rij", !alles3b.rows.some((r) => r.code === "1e"));
  check("…en dus geen notitie", !alles3b.notes.some((n) => n.includes("rubriek 1e")));
}

console.log("\n— [VERLEGD-NAAR-MIJ] rubriek 2a: verlegde BTW, aangegeven én afgetrokken —");
{
  // Een aannemer met € 20.000 aan onderaanneming waarop de BTW naar hem is verlegd. De regeling
  // raakt de aangifte op twee regels tegelijk: € 4.200 verschuldigd in 2a, en exact hetzelfde
  // bedrag terug in 5b. Bij volledige aftrek betaalt hij er niets over — en juist daarom lijkt
  // weglaten onschuldig. Het is het niet: de aangifte sluit dan niet aan op die van zijn
  // onderaannemer, en de Belastingdienst legt die twee naast elkaar.
  const input: AangifteInput = {
    salesByRate: [{ rate: 21, omzet: 50000, btw: 10500 }],
    btwVoorbelasting: 3000,
    cashOmzetZonderBtw: 0,
    verlegdNaarMij: { grondslag: 20000, btw: 4200, aantal: 2 },
  };
  const a = buildAangifte(input, compl(), "Q2 2026");
  const row = (c: string) => a.rows.find((r) => r.code === c);
  check("2a staat op de aangifte: grondslag 20.000 / btw 4.200",
    row("2a")?.omzet === 20000 && row("2a")?.btw === 4200);
  check("5a telt 2a mee: 10.500 + 4.200 = 14.700", a.verschuldigd === 14700);
  check("5b telt dezelfde 4.200 af: 3.000 + 4.200 = 7.200", a.voorbelasting === 7200);
  // De hele regeling hangt hieraan: hetzelfde getal aan beide kanten, dus het saldo verandert niet.
  check("5g ongewijzigd t.o.v. zonder verlegging (10.500 - 3.000 = 7.500)", a.saldo === 7500);
  check("de notitie waarschuwt dat het tarief NIET op de factuur staat",
    a.notes.some((n) => n.includes("GEEN tarief")));
  check("de notitie noemt hoeveel facturen het betreft", a.notes.some((n) => n.includes("2 inkoopfacturen")));
}

console.log("\n— [VERLEGD-NAAR-MIJ] zonder verlegging blijft de aangifte precies zoals hij was —");
{
  // De tegenproef. Een bakker heeft geen verlegde inkoop; dan hoort er geen 2a-regel te staan,
  // ook geen van nul. Een lege rubriek op een formulier is ruis, en ruis wordt genegeerd.
  const zonder: AangifteInput = {
    salesByRate: [{ rate: 21, omzet: 50000, btw: 10500 }],
    btwVoorbelasting: 3000,
    cashOmzetZonderBtw: 0,
  };
  const a = buildAangifte(zonder, compl(), "Q2 2026");
  check("geen 2a-regel", !a.rows.some((r) => r.code === "2a"));
  check("5a onveranderd", a.verschuldigd === 10500);
  check("5b onveranderd", a.voorbelasting === 3000);
  check("geen verleggingsnotitie", !a.notes.some((n) => n.includes("naar jou heeft verlegd")));

  // En een nul-verlegging telt óók niet mee: 'aangetroffen maar nul' is hetzelfde als niets.
  const nul = buildAangifte({ ...zonder, verlegdNaarMij: { grondslag: 0, btw: 0, aantal: 0 } }, compl(), "Q2 2026");
  check("een nul-verlegging levert geen rubriek op", !nul.rows.some((r) => r.code === "2a"));
}

console.log("\n— [VERLEGD-AFTREK] wat van 2a in 5b terugkomt volgt het recht op aftrek —");
{
  // 5b nam het hele 2a-bedrag voor iedereen. Een deels vrijgestelde eigenaar (pro rata 20%) met
  // € 10.000 onderaanneming trok zo € 2.100 af waar € 420 mocht — € 1.680 te weinig aangegeven,
  // en de notitie ernaast zei "per saldo betaal je er niets over".
  const basis: AangifteInput = {
    salesByRate: [{ rate: 21, omzet: 50000, btw: 10500 }],
    btwVoorbelasting: 3000,
    cashOmzetZonderBtw: 0,
  };
  const pro = buildAangifte(
    { ...basis, exemptRegime: true, proRataPercent: 20, verlegdNaarMij: { grondslag: 10000, btw: 2100, aantal: 1, aftrekbaar: 420 } },
    compl(), "Q2 2026",
  );
  check("2a blijft het volle bedrag: 2.100", pro.rows.find((r) => r.code === "2a")?.btw === 2100);
  check("5a telt het volle bedrag: 10.500 + 2.100 = 12.600", pro.verschuldigd === 12600);
  check("5b neemt alleen het aftrekbare deel: 3.000 + 420 = 3.420", pro.voorbelasting === 3420);
  check("5g draagt het verschil: 12.600 − 3.420 = 9.180", pro.saldo === 9180);
  check("de notitie noemt beide bedragen", pro.notes.some((n) => n.includes("€2.100") && n.includes("€420")));
  check("…en belooft niet langer dat het per saldo niets kost",
    !pro.notes.some((n) => n.includes("per saldo betaal je er niets over")));

  // KOR: geen recht op aftrek (art. 25 Wet OB) — wat de aanroeper ook meegeeft.
  const kor = buildAangifte(
    { ...basis, korActive: true, verlegdNaarMij: { grondslag: 10000, btw: 2100, aantal: 1, aftrekbaar: 2100 } },
    compl(), "Q2 2026",
  );
  // [KOR-AANGIFTE-UIT] En de gewone voorbelasting evenmin: onder de KOR is 5b nul.
  check("onder de KOR komt er niets terug in 5b — ook de gewone voorbelasting niet", kor.voorbelasting === 0);
  check("…terwijl 5a 2a wél draagt", kor.verschuldigd === 12600);
  check("de notitie zegt dat je die BTW betaalt", kor.notes.some((n) => n.includes("Onder de KOR heb je geen recht op aftrek")));

  // Een aanroeper zonder aftrekbaar-veld (volledig recht op aftrek): precies het oude gedrag.
  const oud = buildAangifte({ ...basis, verlegdNaarMij: { grondslag: 10000, btw: 2100, aantal: 1 } }, compl(), "Q2 2026");
  check("zonder aftrekbaar-veld valt 2a tegen 5b weg", oud.voorbelasting === 5100 && oud.saldo === 7500);
}

console.log("\n— [EURO] 3b rondt af zoals de rest van het formulier —");
{
  // Een netto-negatief EU-kwartaal van € −1,50. Math.round gaf −1 tegen een 1e-pot die met euro()
  // op −2 stond: € −1 bleef in 1e achter naast een ICP-opgaaf die −2 zegt.
  const a = buildAangifte(
    { salesByRate: [{ rate: 0, omzet: -1.5, btw: 0 }], intraEuOmzet: -1.5, btwVoorbelasting: 0, cashOmzetZonderBtw: 0 },
    compl(), "Q1 2026",
  );
  check("3b = −2, hetzelfde als euro(−1,5)", a.rows.find((r) => r.code === "3b")?.omzet === -2);
  check("niets blijft in 1e achter", !a.rows.some((r) => r.code === "1e"));
}

console.log("\n— [BUITENLANDSE-INKOOP] rubriek 4a en 4b: verlegde btw uit het buitenland, aangegeven én afgetrokken —");
{
  // Een zzp'er met Adobe (IE) en AWS (LU) voor € 1.000 en een Britse ontwerper en OpenAI (US) voor
  // € 4.300. Geen van die facturen draagt Nederlandse btw: die is naar hem verlegd. Vóór dit blok
  // stond er niets — twee regels fout, en onder de KOR het hele bedrag te weinig aangegeven.
  const basis: AangifteInput = {
    salesByRate: [{ rate: 21, omzet: 50000, btw: 10500 }],
    btwVoorbelasting: 3000,
    cashOmzetZonderBtw: 0,
  };
  const a = buildAangifte(
    {
      ...basis,
      verlegdBinnenEu: { grondslag: 1000, btw: 210, aantal: 2, aftrekbaar: 210 },
      verlegdBuitenEu: { grondslag: 4300, btw: 903, aantal: 2, aftrekbaar: 903 },
    },
    compl({ hasEuPurchase: true }), "Q3 2026",
  );
  const row = (c: string) => a.rows.find((r) => r.code === c);
  check("4b staat op de aangifte: grondslag 1.000 / btw 210", row("4b")?.omzet === 1000 && row("4b")?.btw === 210);
  check("4a staat op de aangifte: grondslag 4.300 / btw 903", row("4a")?.omzet === 4300 && row("4a")?.btw === 903);
  check("5a telt beide mee: 10.500 + 210 + 903 = 11.613", a.verschuldigd === 11613);
  check("5b trekt dezelfde bedragen af: 3.000 + 210 + 903 = 4.113", a.voorbelasting === 4113);
  check("5g ongewijzigd: 7.500", a.saldo === 7500);
  // 1a en 1b staan altijd op het formulier (ook op nul, zoals de echte aangifte hierboven).
  check("de rubrieken staan in de volgorde van het formulier", a.rows.map((r) => r.code).join(",") === "1a,1b,4a,4b");
  check("4a heeft zijn eigen notitie, met 'buiten de EU'",
    a.notes.some((n) => n.includes("rubriek 4a") && n.includes("buiten de EU") && n.includes("€903")));
  check("4b heeft zijn eigen notitie, met 'in een ander EU-land'",
    a.notes.some((n) => n.includes("rubriek 4b") && n.includes("in een ander EU-land") && n.includes("€210")));
  check("…die het voorgestelde tarief noemt en zegt dat het niet op de factuur staat",
    a.notes.some((n) => n.includes("rubriek 4b") && n.includes("21%") && n.includes("staat niet op zo'n factuur")));
  check("bij volledige aftrek zegt de notitie dat je er per saldo niets over betaalt",
    a.notes.some((n) => n.includes("rubriek 4b") && n.includes("per saldo betaal je er niets over")));
  check("de oude terugvalzin ('NIET automatisch berekend') staat er niet meer naast",
    !a.notes.some((n) => n.includes("NIET automatisch berekend")));

  // Met 2a en 3b erbij: 1a, 2a, 3b, 4a, 4b — de volgorde van het papier, hoe de regels ook binnenkwamen.
  const vol = buildAangifte(
    {
      ...basis,
      salesByRate: [{ rate: 21, omzet: 1000, btw: 210 }, { rate: 0, omzet: 500, btw: 0 }],
      intraEuOmzet: 500,
      verlegdNaarMij: { grondslag: 100, btw: 21, aantal: 1 },
      verlegdBuitenEu: { grondslag: 100, btw: 21, aantal: 1 },
      verlegdBinnenEu: { grondslag: 100, btw: 21, aantal: 1 },
    },
    compl(), "Q3 2026",
  );
  check("1a, 1b, 2a, 3b, 4a, 4b — de volgorde van het formulier", vol.rows.map((r) => r.code).join(",") === "1a,1b,2a,3b,4a,4b");
  check("5a = 210 + 21 + 21 + 21 = 273", vol.verschuldigd === 273);
  check("5b = 3.000 + 21 + 21 + 21 = 3.063", vol.voorbelasting === 3063);
}

console.log("\n— [BUITENLANDSE-INKOOP] KOR en pro rata: wat van 4a/4b in 5b terugkomt —");
{
  const basis: AangifteInput = {
    salesByRate: [{ rate: 21, omzet: 50000, btw: 10500 }],
    btwVoorbelasting: 3000,
    cashOmzetZonderBtw: 0,
  };
  // KOR: geen recht op aftrek (art. 25 Wet OB) — de verlegde btw is dan echt verschuldigd.
  const kor = buildAangifte(
    { ...basis, korActive: true, verlegdBuitenEu: { grondslag: 1000, btw: 210, aantal: 1, aftrekbaar: 210 } },
    compl(), "Q3 2026",
  );
  check("onder de KOR staat 4a er wél: 210 verschuldigd", kor.rows.find((r) => r.code === "4a")?.btw === 210 && kor.verschuldigd === 10710);
  check("…en komt er niets van terug in 5b — 5b is onder de KOR nul", kor.voorbelasting === 0);
  check("de notitie zegt dat je die btw betaalt",
    kor.notes.some((n) => n.includes("rubriek 4a") && n.includes("Onder de KOR heb je geen recht op aftrek")));

  // Pro rata 20%: 4b het volle bedrag, 5b alleen het aftrekbare deel.
  const pro = buildAangifte(
    { ...basis, exemptRegime: true, proRataPercent: 20, verlegdBinnenEu: { grondslag: 1000, btw: 210, aantal: 1, aftrekbaar: 42 } },
    compl(), "Q3 2026",
  );
  check("pro rata: 4b vol (210), 5b alleen het aftrekbare deel (3.000 + 42)",
    pro.rows.find((r) => r.code === "4b")?.btw === 210 && pro.voorbelasting === 3042);
  check("de notitie noemt het afgetrokken bedrag", pro.notes.some((n) => n.includes("rubriek 4b") && n.includes("€42")));
  check("…en belooft niet dat het per saldo niets kost",
    !pro.notes.some((n) => n.includes("rubriek 4b") && n.includes("per saldo betaal je er niets over")));

  // Zonder aftrekbaar-veld (volledig recht op aftrek): hetzelfde getal aan beide kanten.
  const oud = buildAangifte({ ...basis, verlegdBinnenEu: { grondslag: 1000, btw: 210, aantal: 1 } }, compl(), "Q3 2026");
  check("zonder aftrekbaar-veld valt 4b tegen 5b weg", oud.voorbelasting === 3210 && oud.saldo === 7500);

  // Null = uitgerekend en niets gevonden: geen rubriek, geen notitie — ook niet de oude terugvalzin,
  // want de aanroeper heeft 4b zelf uitgerekend. Undefined = niet uitgerekend: die zin blijft.
  const niets = buildAangifte({ ...basis, verlegdBuitenEu: null, verlegdBinnenEu: null }, compl({ hasEuPurchase: true }), "Q3 2026");
  check("null: geen 4a/4b-regel en geen notitie", !niets.rows.some((r) => r.code === "4a" || r.code === "4b") && !niets.notes.some((n) => n.includes("rubriek 4")));
  const nietBerekend = buildAangifte(basis, compl({ hasEuPurchase: true }), "Q3 2026");
  check("undefined: een aanroeper die 4b niet uitrekent krijgt de terugvalzin nog", nietBerekend.notes.some((n) => n.includes("NIET automatisch berekend")));
  const nul = buildAangifte({ ...basis, verlegdBuitenEu: { grondslag: 0, btw: 0, aantal: 0 } }, compl(), "Q3 2026");
  check("een nul-rubriek wordt niet afgedrukt", !nul.rows.some((r) => r.code === "4a"));
}

console.log("\n— [KOR-AANGIFTE-UIT] onder de KOR staat de aangifte uit, behalve wat de wet verschuldigd houdt —");
{
  // Een kapster in de KOR: € 15.000 omzet zonder btw, € 800 btw op inkopen. Vóór dit blok stond
  // hier een volle tabel met een notitie eronder dat de cijfers niet golden.
  const kor = buildAangifte(
    { salesByRate: [{ rate: 0, omzet: 15000, btw: 0 }], btwVoorbelasting: 800, cashOmzetZonderBtw: 0, korActive: true },
    compl({ outgoingInvoiceCount: 12 }), "Q3 2026",
  );
  check("geen enkele rubriek: ook 1a en 1b niet, ook 1e niet", kor.rows.length === 0);
  check("5a = 0, 5b = 0, 5g = 0", kor.verschuldigd === 0 && kor.voorbelasting === 0 && kor.saldo === 0);
  check("het concept zegt dat het onder de KOR staat", kor.korActive === true);
  check("de notitie zegt: geen btw-aangifte, geen omzetrubrieken, geen voorbelasting",
    kor.notes.some((n) => n.startsWith("KOR actief: je doet geen btw-aangifte")));
  check("…en dat er niets aan te geven is", kor.notes.some((n) => n === "Er is dit kwartaal niets aan te geven."));
  check("geen 'Verkoop-BTW (5a) is berekend uit' — de rubrieken zijn leeg op grond, niet door gebrek",
    !kor.notes.some((n) => n.includes("Verkoop-BTW (5a) is berekend")) && !kor.notes.some((n) => n.includes("Voorbelasting (5b) telt")));
  check("…en niet 'nog geen omzet ingevoerd'", !kor.notes.some((n) => n.includes("nog geen omzet ingevoerd")));
  const csv = buildAangifteCsv(kor);
  check("de CSV zegt waarom de rubrieken leeg zijn", /KOR actief: geen btw-aangifte/.test(csv));

  // Art. 37 Wet OB: btw die op een factuur staat is verschuldigd, KOR of niet.
  const gesteld = buildAangifte(
    { salesByRate: [{ rate: 21, omzet: 1000, btw: 210 }, { rate: 0, omzet: 5000, btw: 0 }], btwVoorbelasting: 800, cashOmzetZonderBtw: 0, korActive: true },
    compl(), "Q3 2026",
  );
  check("een factuur mét btw blijft staan: alleen 1a, 1.000 / 210",
    gesteld.rows.map((r) => r.code).join(",") === "1a" && gesteld.rows[0].omzet === 1000 && gesteld.rows[0].btw === 210);
  check("5a = 210, 5b blijft 0, 5g = 210", gesteld.verschuldigd === 210 && gesteld.voorbelasting === 0 && gesteld.saldo === 210);
  check("de notitie noemt art. 37, het bedrag en de creditnota",
    gesteld.notes.some((n) => n.includes("art. 37 Wet OB") && n.includes("creditnota") && n.includes("€210")));
  check("de 0%-omzet staat nergens (geen 1e)", !gesteld.rows.some((r) => r.code === "1e"));

  // Verlegde btw (2a/4a/4b) blijft verschuldigd, en het concept zegt hoe je die aangeeft.
  const verlegd = buildAangifte(
    {
      salesByRate: [{ rate: 0, omzet: 15000, btw: 0 }], btwVoorbelasting: 800, cashOmzetZonderBtw: 0, korActive: true,
      intraEuOmzet: 2000,
      verlegdNaarMij: { grondslag: 1000, btw: 210, aantal: 1 },
      verlegdBinnenEu: { grondslag: 500, btw: 105, aantal: 1, aftrekbaar: 105 },
    },
    compl(), "Q3 2026",
  );
  check("alleen 2a en 4b — geen 1e, geen 3b", verlegd.rows.map((r) => r.code).join(",") === "2a,4b");
  check("5a = 315, 5b = 0 (geen aftrek), 5g = 315", verlegd.verschuldigd === 315 && verlegd.voorbelasting === 0 && verlegd.saldo === 315);
  check("de notitie zegt dat je een aangifte voor dit tijdvak aanvraagt",
    verlegd.notes.some((n) => n.includes("vraag die dan aan bij de Belastingdienst")));
  check("…en niet dat er niets aan te geven is", !verlegd.notes.some((n) => n === "Er is dit kwartaal niets aan te geven."));

  // Buiten de KOR verandert er niets: 1a en 1b staan er altijd, ook op nul, en 5b telt gewoon.
  const gewoon = buildAangifte({ salesByRate: [{ rate: 0, omzet: 15000, btw: 0 }], btwVoorbelasting: 800, cashOmzetZonderBtw: 0 }, compl(), "Q3 2026");
  check("zonder KOR: 1a, 1b en 1e, 5b = 800, korActive false",
    gewoon.rows.map((r) => r.code).join(",") === "1a,1b,1e" && gewoon.voorbelasting === 800 && gewoon.korActive === false);
  check("zonder KOR geen KOR-regel in de CSV", !/KOR actief/.test(buildAangifteCsv(gewoon)));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);


