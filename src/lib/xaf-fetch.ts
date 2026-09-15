// src/lib/xaf-fetch.ts
// [XAF-BRON] The reads behind an auditfile, in ONE place, because there are now two doors to it.
//
// This code was the body of /api/xaf. That was fine while the download was the only way to get an
// XAF — and it was not: email.ts tells every accountant that the quarterly package "bevat de PDF's,
// een CSV-overzicht en het XAF 3.2-auditbestand", and the recipient of that mail has NO ACCOUNT
// ("Je hebt hiervoor geen account nodig"). So the one caller of buildXafFile sat behind a login the
// promised reader cannot pass, and closing-package.ts wrote sixteen files, none of them .xaf.
//
// Copying the reads into the package builder would have made two answers to "what books into the
// auditfile", diverging on the first change — the failure mode AGENTS.md and half the gates in this
// repo are written about. So the reads move here and both doors call them.
//
// [NO-SILENT-EMPTY] Every read THROWS on failure. An auditfile missing a table's rows is not a
// smaller administration, it is a WRONG one that an accountant imports whole. The route turns that
// into a 503; the package builder turns it into a stated warning and ships without the file.
//
// Every attribution AUTHORITY is imported, never restated: isVerifiedForPackage/effectiveDirection
// decide which invoices book, toResultBankTx decides what a card payout is, liveCashEntries decides
// which cash rows exist, fetchRateShares supplies the mixed-rate split.

import type { PipelineClient } from "@/lib/supabase-pipeline";
import { effectiveTaxKind } from "./tax-letter";
import { isQuote } from "./offerte-followup";
import { fetchAllRows, fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { isVerifiedForPackage, effectiveDirection } from "@/lib/package-attribution";
import { toResultBankTx } from "@/lib/financial-result";
import { liveCashEntries } from "@/lib/cash-live";
import { fetchRateShares } from "@/lib/btw-rate-split-fetch";
import { turnoverNetOmzet } from "@/lib/turnover";
import { getVatScheme } from "@/lib/vat-scheme";
import { amsterdamToday } from "@/lib/format-nl";
import type { XafInput } from "@/lib/xaf-export";
import { readAssets } from "@/lib/compute-result-range";
import { depreciationInRange } from "@/lib/depreciation";

/**
 * Assemble the XafInput for one owner and one year.
 *
 * `through` is the LAST day to include, inclusive. It exists for the quarterly package: a package
 * for Q2 may not carry Q3's bookings, and an auditfile whose header says 31 December while its
 * entries stop in June is a file that lies about its own scope. Absent → the whole year.
 *
 * The declared endDate is clamped to today either way ([XAF-PERIODE]): a file may not declare days
 * that have not happened.
 *
 * Note what this does NOT do: it does not window the START. XAF 3.2 as this repo emits it opens on
 * 1 January and declares MONTH periods (xaf-export.ts:567,633) — it is a year-to-date file by
 * construction, and pretending otherwise by moving startDate would leave the periods contradicting
 * the header. So a quarterly package carries a year-to-date file, and says so in LEESMIJ.txt in
 * the one sentence that matters: a later quarter REPLACES this file, it does not add to it.
 */
export async function buildXafInputForOwner(args: {
  pipeline: PipelineClient;
  ownerId: string;
  year: number;
  through?: string | null;
}): Promise<XafInput> {
  const { pipeline, ownerId, year } = args;
  const start = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const through = args.through && args.through < yearEnd ? args.through : yearEnd;
  const end = through;

  // ── Company ──
  const { data: profile, error: profErr } = await pipeline
    .from("profiles")
    .select("company_name, full_name, kvk_number, btw_number, address, postal_code, city, kor_active")
    .eq("id", ownerId)
    .maybeSingle();
  if (profErr) throw new Error(`profiel: ${profErr.message}`);

  // ── Invoices, both directions, through the package's own verified/direction rules ──
  const invRows = await fetchAllRows<{
    id: string; invoice_number: string | null; direction: string | null; status: string | null;
    invoice_type: string | null; total_ex_btw: number | null; btw_amount: number | null;
    invoice_date: string | null; receiver_id: string | null; client_name: string | null;
    // [XAF-TEGENPARTIJ] Het btw-nummer van de tegenpartij hoort in het auditfile (taxRegIdent), en
    // supplier_id is de tweede bron voor de facturen die het zelf niet dragen — zie hieronder.
    client_btw_number: string | null; supplier_id: string | null;
    // [GROOTBOEK] Newer than the generated types, hence the relaxed client below.
    ledger_account: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }>((from, to) => (pipeline as any)
    .from("invoices")
    .select("id, invoice_number, direction, status, invoice_type, total_ex_btw, btw_amount, invoice_date, sender_id, receiver_id, client_name, client_btw_number, supplier_id, tax_kind, ledger_account")
    .or(`sender_id.eq.${ownerId},receiver_id.eq.${ownerId}`)
    .gte("invoice_date", start)
    .lte("invoice_date", end)
    .order("id", { ascending: true }).range(from, to));
  const attributed = invRows
    .map((r) => ({ ...r, direction: effectiveDirection(r, ownerId) }))
    // [OFFERTE-GEEN-OMZET] A quote is not a booking. It reached this file with direction
    // 'outgoing' and status 'sent', and xaf-export captions anything that is not a creditnota
    // "Verkoopfactuur" — so an unaccepted quote became a VRK journal entry in the auditfile the
    // accountant and the Belastingdienst read, with a debiteuren line and a "BTW over omzet" line,
    // for a document that carries no invoice number at all (Art. 35 Wet OB).
    .filter((r) => !isQuote(r.invoice_type))
    .filter(isVerifiedForPackage);
  const outgoing = attributed.filter((r) => r.direction === "outgoing");
  const incoming = attributed.filter((r) => r.direction === "incoming");
  // ── [XAF-TEGENPARTIJ] Het btw- en KVK-nummer van de leveranciers ──────────────────────────
  //
  // Gemeten op productie: 488 van de 495 geboekte inkoopfacturen dragen geen btw-nummer, omdat de
  // app het pas sinds 30 augustus uitleest (7 nieuwe facturen: 5 mét). Het staat wél op het papier
  // én bij 26 van de 54 leveranciers in deze administratie — goed voor 311 van die 488 rijen.
  //
  // Dus haalt het auditfile het daar op. NIET terugschrijven op de facturen: het document noemt dat
  // nummer niet en de app zou dan een gegeven verzinnen. Afleiden bij export is iets anders dan
  // bewaren alsof het gelezen is, en dat verschil is precies wat een auditfile controleerbaar maakt.
  const leverancierIds = [...new Set(incoming.map((r) => r.supplier_id).filter((x): x is string => !!x))];
  const btwPerLeverancier = new Map<string, { btw: string | null; kvk: string | null }>();
  if (leverancierIds.length > 0) {
    // [IN-CHUNK] Gechunkt: het aantal leveranciers groeit met de administratie mee, en een 414 zou
    // hier als "geen leveranciers bekend" lezen — een auditfile dat stil minder compleet is.
    const rijen = await fetchAllRowsForIds<{ id: string; btw_number: string | null; kvk_number: string | null }, string>(
      leverancierIds,
      (chunk, from, to) => pipeline
        .from("suppliers")
        .select("id, btw_number, kvk_number")
        .in("id", chunk)
        .range(from, to) as unknown as PromiseLike<{ data: Array<{ id: string; btw_number: string | null; kvk_number: string | null }> | null; error: { message: string } | null }>,
    );
    for (const r of rijen) btwPerLeverancier.set(r.id, { btw: r.btw_number, kvk: r.kvk_number });
  }

  const { rateShares, degraded: splitDegraded } = await fetchRateShares(pipeline, outgoing.map((r) => ({ id: r.id, total_ex_btw: r.total_ex_btw, btw_amount: r.btw_amount })));

  // ── Bank lines + the direction of whatever invoice each one settles ──
  const bankRows = await fetchAllRows<{
    id: string; amount: number | null; category: string | null; invoice_id: string | null;
    date: string | null; description: string | null; counterpart_name: string | null;
  }>((from, to) => pipeline
    .from("bank_transactions")
    .select("id, amount, category, invoice_id, date, description, counterpart_name")
    .eq("user_id", ownerId)
    .gte("date", start)
    .lte("date", end)
    .order("id", { ascending: true }).range(from, to));
  const linkedIds = bankRows.map((b) => b.invoice_id).filter((x): x is string => !!x);
  // A linked invoice may be dated in ANOTHER year — fetch by id, not by window.
  const linkedRows = await fetchAllRowsForIds<{ id: string; direction: string | null; receiver_id: string | null; invoice_number: string | null }, string>(
    linkedIds,
    (chunk, from, to) => pipeline
      .from("invoices")
      // [XAF-OMSCHRIJVING] The number too: a bank entry that says which invoice it settles is the
      // difference between a ledger an accountant can read and one that repeats the bank's own code.
      .select("id, direction, receiver_id, invoice_number")
      .in("id", chunk)
      .order("id", { ascending: true }).range(from, to),
  );
  const linkedDirection = new Map(linkedRows.map((r) => [r.id, effectiveDirection(r, ownerId)]));
  const linkedNumber = new Map(linkedRows.map((r) => [r.id, r.invoice_number]));

  // ── Cash rows ([KAS-ZACHT]: live ones only) ──
  const liveCash = await liveCashEntries(pipeline);
  const cashRows = await fetchAllRows<{
    id: string; direction: string | null; amount: number | null; category: string | null;
    btw_rate: number | null; entry_date: string | null; document_id: string | null;
    invoice_id: string | null;
  }>((from, to) => liveCash.only(pipeline
    .from("cash_entries")
    .select("id, direction, amount, category, btw_rate, entry_date, document_id, invoice_id")
    .eq("user_id", ownerId)
    .gte("entry_date", start)
    .lte("entry_date", end))
    .order("id", { ascending: true }).range(from, to));

  // ── Till Z-days + the covered set (same predicate as the result engine) ──
  const turnoverRows = await fetchAllRows<{
    turnover_date: string; base_0: number | null; base_9: number | null; base_21: number | null;
    btw_9: number | null; btw_21: number | null; total_incl: number | null;
    pin_amount: number | null; cash_amount: number | null; other_amount: number | null;
  }>((from, to) => pipeline
    .from("daily_turnover")
    .select("turnover_date, base_0, base_9, base_21, btw_9, btw_21, total_incl, pin_amount, cash_amount, other_amount")
    .eq("user_id", ownerId)
    .gte("turnover_date", start)
    .lte("turnover_date", end)
    .order("turnover_date", { ascending: true }).range(from, to));
  const coveredDates = new Set(
    turnoverRows
      .filter((t) => turnoverNetOmzet({
        turnover_date: t.turnover_date,
        base_0: t.base_0 ?? 0, base_9: t.base_9 ?? 0, base_21: t.base_21 ?? 0,
        btw_9: t.btw_9 ?? 0, btw_21: t.btw_21 ?? 0,
        total_incl: t.total_incl, pin_amount: t.pin_amount, cash_amount: t.cash_amount, other_amount: t.other_amount,
      }) > 0 || (t.total_incl ?? 0) > 0)
      .map((t) => t.turnover_date),
  );

  // [XAF-PERIODE] The file may not declare days that have not happened — nor days it did not
  // read. `through` is already <= 31 December; today is the second ceiling.
  const vandaag = amsterdamToday();
  const endDate = through < vandaag ? through : vandaag;

  // [XAF-REGIME] The honest limits, said inside the file: under KOR there is no right of
  // deduction (the 1400 lines then need the accountant's judgement), and 0%-omzet is not split
  // into verlegd/vrijgesteld/export here — the aangifte screen is where that split lives.
  const regimeNotes: string[] = [];
  if ((profile as { kor_active?: boolean | null } | null)?.kor_active) {
    regimeNotes.push("Deze onderneming valt onder de KOR: er bestaat geen recht op aftrek van voorbelasting. Beoordeel de 1400-regels in dit bestand voordat je ze overneemt.");
  }
  regimeNotes.push("Omzet op rekening 8020 is 0%/verlegd/vrijgesteld ZONDER onderscheid — de BTW-aangifte in BoekBrug draagt de rubriekverdeling.");

  // [XAF-STELSEL] Welk BTW-stelsel deze ondernemer voert, IN het bestand.
  //
  // Dit bestand boekt op factuurdatum. Dat is voor de journaalposten juist onder beide stelsels —
  // maar onder het kasstelsel is de BTW pas verschuldigd in het kwartaal waarin er BETAALD is, en
  // die verschuiving staat nergens in dit bestand. Een boekhouder die de aangifte uit deze
  // journaalposten afleidt komt dan voor een kasstelsel-klant in het verkeerde kwartaal uit.
  //
  // De regimeNotes bestaan precies hiervoor: ze noemen al de KOR en de ongesplitste 0%-omzet. Het
  // stelsel ontbrak, en dat is de enige van de drie die de TIMING van elk bedrag raakt.
  //
  // Eigen query, met opzet. vat_scheme komt uit een losse migratie (vat_scheme.sql); één kolom
  // erbij in de profielselect hierboven laat op een achterlopende database die HELE select vallen,
  // en dan heeft het auditfile geen bedrijfsnaam meer. Zelfde patroon als kas-payment-events-fetch.
  const { data: schemeRow } = await pipeline
    .from("profiles")
    .select("vat_scheme, vat_scheme_since")
    .eq("id", ownerId)
    .maybeSingle();
  const schemeProfile = schemeRow as { vat_scheme?: string | null; vat_scheme_since?: string | null } | null;
  if (getVatScheme(schemeProfile?.vat_scheme) === "kas") {
    const since = schemeProfile?.vat_scheme_since;
    regimeNotes.push(
      "Deze onderneming voert het KASSTELSEL" +
        (since ? ` (sinds ${since})` : "") +
        ". De journaalposten hieronder staan op FACTUURDATUM; de BTW is echter verschuldigd in het " +
        "kwartaal waarin is betaald. Leid de aangifte niet rechtstreeks uit de datums in dit " +
        "bestand af — de BTW-aangifte in BoekBrug rekent met de betaaldatums.",
    );
  } else {
    // Ook het gewone geval wordt gezegd. "Er staat niets over het stelsel" laat de lezer raden, en
    // een auditfile hoort geen enkele vraag open te laten die het zelf kan beantwoorden.
    regimeNotes.push("Deze onderneming voert het FACTUURSTELSEL: de BTW volgt de factuurdatums in dit bestand.");
  }

  // [SPLIT-EERLIJK] Kon de tariefverdeling niet gelezen worden, dan draagt elke verkoopregel het
  // gemengde tarief uit de factuurkop. De totalen kloppen, de verdeling over de tarieven niet — en
  // dat is precies het soort verschil dat een lezer nooit uit het bestand zelf kan afleiden.
  if (splitDegraded) {
    regimeNotes.push(
      "LET OP: de factuurregels konden niet worden gelezen. Verkoopfacturen met meerdere " +
        "BTW-tarieven staan hier daarom met één tarief uit de factuurkop. De totalen kloppen; de " +
        "verdeling over de tarieven is in dit bestand niet betrouwbaar.",
    );
  }

  // ── [BEDRIJFSMIDDEL] The register: asset purchases leave the kostenrekening, and each asset
  // books one afschrijving per closed month. Only months that END on or before `through` are
  // emitted — a memoriaal dated after today would claim a period that has not happened.
  const assets = await readAssets(pipeline, ownerId);
  const assetInvoiceIds = new Set((assets ?? []).map((a) => a.invoice_id).filter((x): x is string => !!x));
  const depreciation: NonNullable<XafInput["depreciation"]> = [];
  if (assets === null) {
    regimeNotes.push("Het register van bedrijfsmiddelen kon niet gelezen worden: inkopen staan in dit bestand als kosten en er is niet afgeschreven.");
  } else {
    assets.forEach((a, i) => {
      for (let mth = 1; mth <= 12; mth++) {
        const mm = String(mth).padStart(2, "0");
        const first = `${year}-${mm}-01`;
        const last = `${year}-${mm}-${String(new Date(Date.UTC(year, mth, 0)).getUTCDate()).padStart(2, "0")}`;
        if (last > end) break;
        const amount = depreciationInRange(a, first, last);
        if (amount > 0) depreciation.push({ id: `afschr-${i + 1}-${year}-${mm}`, date: last, description: `Afschrijving ${year}-${mm}`, amount });
      }
    });
  }

  return {
    year,
    dateCreated: vandaag,
    endDate,
    regimeNotes,
    company: {
      name: profile?.company_name || profile?.full_name || "Onbekende onderneming",
      kvkNumber: profile?.kvk_number ?? null,
      btwNumber: profile?.btw_number ?? null,
      address: profile?.address ?? null,
      postalCode: profile?.postal_code ?? null,
      city: profile?.city ?? null,
    },
    sales: outgoing.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoice_number,
      invoiceDate: r.invoice_date,
      clientName: r.client_name,
      totalExBtw: r.total_ex_btw ?? 0,
      btwAmount: r.btw_amount ?? 0,
      invoiceType: r.invoice_type,
      rateLines: rateShares.get(r.id) ?? null,
      clientBtwNumber: r.client_btw_number,
    })),
    purchases: incoming.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoice_number,
      invoiceDate: r.invoice_date,
      vendorName: r.client_name,
      totalExBtw: r.total_ex_btw ?? 0,
      btwAmount: r.btw_amount ?? 0,
      asset: assetInvoiceIds.has(r.id),
      // [AANSLAG] The kind that governs where a Belastingdienst letter books; null otherwise.
      taxKind: effectiveTaxKind(r),
      // De factuur eerst — dat is wat het document zei. Pas als die leeg is, de leverancier.
      vendorBtwNumber: r.client_btw_number ?? (r.supplier_id ? btwPerLeverancier.get(r.supplier_id)?.btw ?? null : null),
      vendorKvkNumber: r.supplier_id ? btwPerLeverancier.get(r.supplier_id)?.kvk ?? null : null,
      // [GROOTBOEK] The account the owner put it on. Null travels as null: the export then writes
      // the 4000 it always wrote, and "not decided" stays distinguishable from "decided on 4000".
      ledgerAccount: (r as { ledger_account?: string | null }).ledger_account ?? null,
    })),
    bank: bankRows.map((b) => ({
      id: b.id,
      date: b.date,
      amount: b.amount ?? 0,
      description: b.description,
      category: b.category,
      linkedInvoiceDirection: b.invoice_id ? linkedDirection.get(b.invoice_id) ?? null : null,
      linkedInvoiceNumber: b.invoice_id ? linkedNumber.get(b.invoice_id) ?? null : null,
      counterpartName: b.counterpart_name,
      posSettlement: toResultBankTx(b).posSettlement === true,
    })),
    cash: cashRows.map((c) => ({
      id: c.id,
      date: c.entry_date,
      direction: c.direction === "in" ? "in" : "out",
      amount: c.amount ?? 0,
      category: c.category,
      btwRate: c.btw_rate,
      documentId: c.document_id,
      invoiceId: c.invoice_id,
      coveredByTurnover: c.category === "omzet" && c.entry_date != null && coveredDates.has(c.entry_date),
    })),
    depreciation,
    turnover: turnoverRows.map((t) => ({
      date: t.turnover_date,
      base0: t.base_0 ?? 0, base9: t.base_9 ?? 0, base21: t.base_21 ?? 0,
      btw9: t.btw_9 ?? 0, btw21: t.btw_21 ?? 0,
      pinAmount: t.pin_amount ?? 0, cashAmount: t.cash_amount ?? 0, otherAmount: t.other_amount ?? 0,
      totalIncl: t.total_incl,
    })),
  };
}
