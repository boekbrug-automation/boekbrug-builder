// src/lib/bank-ignored-excluded.ts
// [GENEGEERD-TELT] Welke genegeerde bankregels NIET in de boekhouding horen — als ids.
// Run: npx tsx --test src/lib/bank-ignored-excluded.test.ts
//
// ── WAAROM DIT EEN EIGEN, WEGVALLENDE LEZING IS ──
//
// De reden staat in bank_transactions.ignore_reason, en die kolom komt uit een met de hand
// toegepaste migratie (bank_ignore_reason.sql). Een kolom die PostgREST niet kent weigert de HELE
// select waarin hij staat — dus hem meenemen in de bankregel-lezing van het resultaat, de aangifte,
// de readiness en het jaarpakket zou van een achterlopende migratie vier schermen zonder één
// bankregel maken. Precies de afweging die readiness al maakt voor auto_match_reason, en om
// dezelfde reden apart gehouden.
//
// De terugval is hier bovendien exact het juiste antwoord: bestaat de kolom niet, dan kan geen
// enkele regel een reden dragen, dus hoort er ook niets te worden uitgesloten. Een lege verzameling
// is dan geen verlies maar de waarheid.
//
// ── WAT ER OP HET SPEL STAAT ──
//
// Een regel die de eigenaar wegzet als "privé", "dubbel" of "niet van mij" bleef in de kosten staan
// en zijn BTW in de voorbelasting. Bij privé is dat een aftrek waarvan de eigenaar ZELF heeft
// gezegd dat er geen recht op bestaat; bij dubbel is het een kost die twee keer telt, gemeld door
// degene die hem meldde. Zie ignoredLineCountsInBooks voor waarom "hier komt geen factuur bij"
// (huur, lease, abonnement) juist wél moet blijven tellen — dat weghalen zou de winst verhogen en
// de eigenaar te veel belasting laten betalen, en dat is de duurdere van de twee fouten.

import { fetchAllRows } from "./supabase-paginate";
import { columnIsAbsent } from "./column-probe";
import { ignoredLineCountsInBooks } from "./bank-ignore-reason";

/**
 * De ids van genegeerde regels in dit venster die volgens hun eigen reden buiten de boeken vallen.
 *
 * Valt weg naar een LEGE verzameling bij elke leesfout, en dat is bewust dezelfde uitkomst als
 * "niets uitgesloten": uitsluiten op grond van een mislukte lezing zou echte kosten uit een
 * kwartaal halen zonder dat iemand weet waarom. De andere richting laat een bekende fout staan,
 * en dat is de fout die zichtbaar blijft.
 */
export async function readExcludedBankIds(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  userId: string;
  /** ISO 'YYYY-MM-DD', inclusief. Hetzelfde venster als de bankregels zelf. */
  start: string;
  end: string;
}): Promise<Set<string>> {
  return (await readExcludedBankIdsChecked(args)).ids;
}

/**
 * [READINESS-DEGRADE] The same read, with the failure carried instead of swallowed.
 *
 * The fallback above is right for the figures (leave the known error standing, take no money out
 * of the quarter on a failed read) — but a caller that decides whether the quarter may be called
 * "klaar" has to know the read did not happen: `failed` is true for any failure OTHER than the
 * column not existing yet, which is the one case where "nothing excluded" is the true answer.
 */
export async function readExcludedBankIdsChecked(args: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
  userId: string;
  start: string;
  end: string;
}): Promise<{ ids: Set<string>; failed: boolean }> {
  const { client, userId, start, end } = args;
  const out = new Set<string>();
  try {
    const rows = await fetchAllRows<{ id: string; ignore_reason: string | null }>((from, to) =>
      client
        .from("bank_transactions")
        .select("id, ignore_reason")
        .eq("user_id", userId)
        // Alleen genegeerde regels. Een reden op een actieve regel zou een oude aantekening zijn —
        // rematch en restore wissen hem juist daarom — en mag nooit iets uit de boeken houden.
        .eq("status", "not_found")
        .gte("date", start)
        .lte("date", end)
        .order("id", { ascending: true })
        .range(from, to),
    );
    for (const r of rows) {
      if (!r?.id) continue;
      if (!ignoredLineCountsInBooks(r.ignore_reason)) out.add(r.id);
    }
  } catch (e) {
    // Pre-migratie (geen kolom) → geen redenen → niets uit te sluiten, wat daar het ware antwoord
    // is. Elke andere storing valt op dezelfde plek terug, om de reden in de kop: liever de bekende
    // fout laten staan dan stilzwijgend geld uit iemands kwartaal halen — maar de aanroeper hoort
    // WEL dat de lezing niet is gebeurd (failed), zodat een oordeel er niet op groen kan gaan.
    const absent = columnIsAbsent(e as { code?: string; message?: string }, "ignore_reason");
    if (!absent) console.error("[GENEGEERD-TELT] ignore_reason read failed — nothing excluded, and said so", { userId, error: e instanceof Error ? e.message : String(e) });
    return { ids: new Set<string>(), failed: !absent };
  }
  return { ids: out, failed: false };
}
