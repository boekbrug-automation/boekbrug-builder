// src/app/dashboard/incoming/page.tsx
// [BOEK-011] Incoming invoices page — server component
// Fetches connection status + pending invoices + ignored invoices

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getSessionUser } from "@/lib/session-user";
import IncomingInvoicesClient from "./IncomingInvoicesClient";
// [IMPORT-MONITOR] Part 1 — read-time health classification (visibility only).
import {
  classifyImportHealth,
  type ImportHealth,
  type FieldConfidence,
} from "@/lib/import-health";
// [QUEUE-COMPLETE] pages past PostgREST's silent ~1000-row cap.
import { fetchAllRows, fetchAllRowsForIds } from "@/lib/supabase-paginate";
import { planForUser } from "@/lib/fair-use-gate";
import { fairUseLimit } from "@/lib/fair-use";
// [READING-MEMORY] Which suppliers this owner keeps having to correct — built from the audit trail.
import { readingHintFor, vendorKey } from "@/lib/reading-memory";
// [TARIEF-GEHEUGEN] Het tarief dat een leverancier aantoonbaar altijd rekent — zie het blok
// verderop, en vendor-vat-rate.ts voor waarom een gemengde leverancier er géén krijgt.
import { deriveVendorRate, type RatedInvoice } from "@/lib/vendor-vat-rate";

/** [TARIEF-GEHEUGEN] Eén historische factuur, teruggebracht tot wat een tarief eruit afleidt. */
type HistorieRij = {
  client_name: string | null;
  total_ex_btw: number | null;
  btw_amount: number | null;
  total_inc_btw: number | null;
};

// [LEVERANCIER-KIEZEN] The suppliers the owner already has, for the name field in the verify
// modal. The cap lives with the matching it feeds — one number, two screens.
import { SUPPLIER_PICK_LIMIT } from "@/lib/supplier-suggest";
import { loadReadingMemory } from "@/lib/reading-memory-source";

export const dynamic = "force-dynamic";

// [BOEK-011] Shape of an incoming invoice row — matches the client component
interface IncomingInvoiceRow {
  id: string;
  client_name: string;
  client_email: string | null;
  // [BRIDGE-CREDITNOTA-SIGN] 'creditnota' → negative amounts by design; drives
  // the queue badge + the sign-inverted read-time health gate below.
  invoice_type: string | null;
  // [AANSLAG] Which tax a Belastingdienst letter concerns; drives the queue badge.
  tax_kind: string | null;
  total_ex_btw: number;
  btw_amount: number;
  total_inc_btw: number;
  amount_paid?: number | null;
  invoice_date: string;
  invoice_number: string;
  source: string;
  pdf_url: string | null;
  document_id: string | null;
  created_at: string;
  folder_id: string | null;
  folder_name: string | null;
  // [BRIDGE-EXTRACT] per-field AI confidence — drives the modal's "confirm" flags.
  // [IMPORT-MONITOR] widened to FieldConfidence: at runtime this jsonb ALSO
  // carries a nested _safecore object on email-path invoices held for a math
  // problem. The classifier reads it; the existing modal still reads only the
  // flat AI scores (a structural subset), so nothing downstream breaks.
  field_confidence: FieldConfidence | null;
  // [IMPORT-MONITOR] Part 1 — read-time health verdict (clean | needs-review +
  // plain-language reasons). Computed server-side from existing signals only.
  health: ImportHealth;
  // [REREAD-CONFIRMED] Always selected now, on every list — reimportDecision needs it, and so do
  // the two below. The comment that used to stand here said this was only on "Bevestigd"; that was
  // true when only that list displayed it.
  status?: string | null;
  direction?: string | null;
  accountant_status?: string | null;
  // [NEGEER-REDEN] Alleen op de Genegeerd-lijst geselecteerd, en ook daar optioneel: oude rijen
  // hebben hem niet, en zolang de migratie niet gedraaid is bestaat de kolom nog niet.
  archive_reason?: string | null;
  // [SUPERSEDE] The invoice number that replaced this one. Same conditions as archive_reason:
  // only on the Genegeerd list, and optional even there (older rows, and the migration may not
  // have been applied yet).
  superseded_by_number?: string | null;
}

// Plain column list — no join. The join broke the query and emptied the page.
// [BRIDGE-CREDITNOTA-SIGN] + invoice_type (badge + sign-inverted health gate).
const INVOICE_COLUMNS =
  // [CHECKLIST] vendor_iban rides along so the "rekeningnummer ongewijzigd" row can be ANSWERED.
  // Without it every queued invoice would report "er staat geen rekeningnummer op deze factuur" —
  // which is not a missing number on the paper, it is a column we did not ask for, and saying it
  // is the overstatement invoice-checks.ts exists to prevent.
  // [REREAD-CONFIRMED] direction + status + accountant_status ride along for the same reason
  // vendor_iban does: reimportDecision reads all three, and a predicate whose inputs are missing
  // does not fail loudly — it simply answers "no", and the "Opnieuw inlezen" button silently never
  // appears on any card. A control that is never on screen is indistinguishable from one that was
  // never built.
  "id, client_name, client_email, invoice_type, tax_kind, direction, status, accountant_status, total_ex_btw, btw_amount, total_inc_btw, amount_paid, invoice_date, invoice_number, source, pdf_url, document_id, created_at, field_confidence, vendor_iban";

export default async function IncomingPage() {
  const supabase = await createServerSupabaseClient();

  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser();

  if (!user) redirect("/login");

  // [BOEK-011] Fetch role for the Logo Universal Click pattern
  // (Navigation Strategy v1.0). Incoming is ZZP-only in practice,
  // but the link is dynamic for consistency across the app.
  // ── [WATERVAL] Acht leesacties die niets van elkaar willen weten ──────────────
  //
  // Ze stonden hier onder elkaar met een `await` ervoor, en dat is precies zo duur als het klinkt:
  // de pagina wachtte acht keer op een heen-en-weer naar de database vóór er één byte naar de
  // browser ging. Niet omdat de tweede de eerste nodig had — ze hebben allemaal alleen `user.id` —
  // maar omdat `await` op een regel eronder nu eenmaal wacht.
  //
  // [NO-SILENT-EMPTY] En parallel lezen mag niet betekenen dat een MISLUKTE lezing weer stil is.
  // Twee sessies raakten dit blok in dezelfde week: de ene maakte er één rit van, de andere gaf
  // elke lezing een vlag. Zonder die vlag valt een kapotte lezing terug op `?? []`, en dan zegt dit
  // scherm "Alles verwerkt" — op de wachtrij betekent die zin dat élke binnengekomen factuur is
  // nagekeken en doorgezet, wat het tegenovergestelde is van wat een mislukte lezing weet. De
  // eigenaar stopt met kijken en een onbevestigde factuur bereikt Crediteuren, de voorbelasting en
  // de aangifte nooit. Dus: één rit én de vlag.
  const readFailed: string[] = [];
  const readOrFlag = async <T,>(label: string, run: () => Promise<T[] | null>): Promise<T[]> => {
    try {
      const rows = await run();
      if (rows === null) throw new Error("read returned no rows object");
      return rows;
    } catch (e) {
      console.error("[NO-SILENT-EMPTY] incoming source read failed", {
        userId: user.id, source: label, error: e instanceof Error ? e.message : String(e),
      });
      readFailed.push(label);
      return [];
    }
  };
  // Ze stonden hier onder elkaar met een `await` ervoor, en dat is precies zo duur als het klinkt:
  // de pagina wachtte acht keer op een heen-en-weer naar de database vóór er één byte naar de
  // browser ging. Niet omdat de tweede de eerste nodig had — ze hebben allemaal alleen `user.id` —
  // maar omdat `await` op een regel eronder nu eenmaal wacht.
  //
  // Dit is de goedkoopste soort snelheid die er is: geen enkele query verandert, geen enkele regel
  // logica verschuift, alleen de VOLGORDE waarin erop gewacht wordt. Wat acht ritten na elkaar was,
  // is nu één rit voor alle acht.
  //
  // Wat NIET in deze golf zit, en waarom: de mappenpaden van de documenten. Die query heeft de
  // document_id's van de facturen hierboven nodig, dus die kán niet eerder — hij staat verderop als
  // tweede golf. Een read die van een ander afhangt hoort niet in een Promise.all; dat is geen
  // stijlkwestie maar het verschil tussen sneller en stuk.
  const ignoredColumns = `${INVOICE_COLUMNS}, archive_reason, superseded_by_number`;
  const fetchIgnored = (columns: string) =>
    fetchAllRows((from, to) => supabase
      .from("invoices")
      .select(columns)
      .eq("receiver_id", user.id)
      .eq("direction", "incoming")
      .eq("status", "archived")
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)
    );

  const [
    profileRes,
    connectionRes,
    pendingRaw,
    ignoredRaw,
    confirmedReceivedRes,
    confirmedPaidRes,
    allFoldersRes,
    readingMemory,
    suppliersRes,
  ] = await Promise.all([
    // [BOEK-011] De rol, voor het Logo Universal Click-patroon.
    supabase.from("profiles").select("role").eq("id", user.id).single(),

    // [MAILBOX-WAAR] ALLE koppelingen, niet één. De vorige versie las er bewust maar één met
    // .limit(1).maybeSingle() — om te voorkomen dat maybeSingle() bij twee rijen null geeft en
    // de eigenaar "niet verbonden" te zien krijgt terwijl zijn mail prima binnenkomt. Dat loste
    // de crash op en liet het echte probleem staan: wie Gmail én Outlook had, zag er één, en wie
    // er één had kreeg nooit te zien dat de tweede nog kon.
    //
    // [ZERO-ROWS-NORMAL] Nul rijen blijft de gewone toestand, geen fout.
    supabase
      .from("email_connections")
      // needs_reauth post-dates the generated types → cast on read (as the sync path does).
      .select("provider, email, connected_at, needs_reauth")
      .eq("user_id", user.id)
      .order("connected_at", { ascending: true }),

    // [QUEUE-COMPLETE] Ongecapt: dit is het ENIGE scherm waar een 'processing'-factuur bevestigd
    // kan worden, terwijl de badges elders de exacte koppen tellen. Met de oude .limit(100) zei
    // een grote backfill "130 wachten" terwijl de wachtrij er 100 toonde.
    //
    // Gesorteerd op invoice_date (nieuwste eerst): created_at is het IMPORT-moment, en dat heeft
    // bij een backfill niets met de echte factuurdatum te maken — daarop sorteren maakte de
    // wachtrij door elkaar gegooid.
    readOrFlag("controlewachtrij", () => fetchAllRows((from, to) => supabase
      .from("invoices")
      .select(INVOICE_COLUMNS)
      .eq("receiver_id", user.id)
      .eq("direction", "incoming")
      .eq("status", "processing")
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to)
        )),

    // Genegeerd: mét het label, en bij een ontbrekende kolom zonder. Zie de toelichting bij
    // fetchIgnored hierboven — een leeg Genegeerd-tabblad is de plek waar niets verloren mag lijken.
    // De kolom-fallback blijft; alleen de LAATSTE redding verandert: lukt zelfs de kale lijst niet,
    // dan zei het tabblad "niets genegeerd" over het enige scherm waar een gearchiveerde factuur
    // terug te halen is. Archiveren is hier het verwijderen, dus dat is een claim dat er niets meer
    // te redden valt.
    readOrFlag("genegeerde facturen", () =>
      fetchIgnored(ignoredColumns).catch(() => fetchIgnored(INVOICE_COLUMNS))),

    // [INBOX-CROWD-OUT] Twee queries, geen gedeelde cap: in één gezamenlijke query verdrongen
    // nieuwere betaalde rijen de oudere ONBETAALDE, en dan stond een openstaande rekening wel op
    // Vandaag maar nergens hier.
    supabase
      .from("invoices")
      .select(`${INVOICE_COLUMNS}, status`)
      .eq("receiver_id", user.id)
      .eq("direction", "incoming")
      .eq("status", "received")
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500),

    supabase
      .from("invoices")
      .select(`${INVOICE_COLUMNS}, status`)
      .eq("receiver_id", user.id)
      .eq("direction", "incoming")
      .eq("status", "paid")
      .order("invoice_date", { ascending: false })
      .order("created_at", { ascending: false })
      // [CIRKEL] Was 50 while the received list gets 500 — the "Bevestigd" tab silently
      // truncated paid history at 50 with no disclosure. 200 matches manage's own window.
      .limit(200),

    // Alle mappen van de eigenaar — nodig om straks de volledige paden op te bouwen. Hij hangt
    // NIET van de documenten af (die koppeling gaat de andere kant op), dus hij mag hier mee.
    supabase.from("folders").select("id, name, parent_id").eq("user_id", user.id),

    // [READING-MEMORY] Wat deze eigenaar bij welke leverancier steeds corrigeert. Eén gedeelde
    // lezing (reading-memory-source.ts), zodat dit scherm en het betaalscherm niet elk iets anders
    // over dezelfde leverancier beweren.
    loadReadingMemory(supabase, user.id),

    // [LEVERANCIER-KIEZEN] De leveranciers die deze eigenaar al heeft, zodat het naamveld in de
    // controlemodal laat zien wat er is in plaats van blanco papier te zijn. Alleen id, naam en
    // rekeningnummer: het veld toont een naam en, om twee bijna gelijke namen uit elkaar te
    // houden, het rekeningnummer eronder.
    supabase
      .from("suppliers")
      .select("id, name, iban")
      .eq("user_id", user.id)
      .order("name")
      .limit(SUPPLIER_PICK_LIMIT),
  ]);

  const { data: profile } = profileRes;
  // [MAILBOX-WAAR] De oudste koppeling is de hoofdkoppeling op het scherm: hij is er het langst,
  // dus het is de mailbox waar de eigenaar aan denkt als hij "mijn mail" zegt.
  const connections = (connectionRes.data ?? []) as Array<{
    provider: string; email: string | null; connected_at: string | null; needs_reauth: boolean | null;
  }>;
  const connection = connections[0] ?? null;
  // [NO-SILENT-EMPTY] `const { data }` zonder `error`: supabase-js gooit niet, het geeft
  // { data: null, error } terug — dus kwam een mislukte lezing hier aan als een leeg tabblad dat
  // zegt dat de eigenaar niets heeft bevestigd. Beide lezingen lopen nu langs dezelfde vlag.
  const { data: confirmedReceivedRaw, error: confirmedReceivedErr } = confirmedReceivedRes;
  const { data: confirmedPaidRaw, error: confirmedPaidErr } = confirmedPaidRes;
  if (confirmedReceivedErr || confirmedPaidErr) {
    console.error("[NO-SILENT-EMPTY] incoming source read failed", {
      userId: user.id, source: "bevestigde facturen",
      error: (confirmedReceivedErr ?? confirmedPaidErr)?.message,
    });
    readFailed.push("bevestigde facturen");
  }
  const { data: allFolders } = allFoldersRes;

  // [LEVERANCIER-KIEZEN] [NO-SILENT-EMPTY] Een mislukte lezing is NIET "je hebt geen leveranciers".
  // Het verschil is zichtbaar op het scherm: bij een lege lijst zegt het veld dat bevestigen een
  // nieuwe leverancier aanmaakt, bij een mislukte lezing zegt het dat de lijst niet geladen kon
  // worden. Het gaat bewust NIET in readFailed: dat vaandel maakt de wachtrij zelf onbetrouwbaar,
  // en een suggestielijst die ontbreekt zegt niets over de facturen erin.
  const { data: supplierRows, error: suppliersErr } = suppliersRes;
  if (suppliersErr) {
    console.error("[LEVERANCIER-KIEZEN] supplier list read failed", {
      userId: user.id, error: suppliersErr.message,
    });
  }
  const suppliers = ((supplierRows ?? []) as { id: string; name: string; iban: string | null }[])
    .filter((s) => typeof s.name === "string" && s.name.trim() !== "");

  const userRole: "zzper" | "accountant" =
    profile?.role === "accountant" ? "accountant" : "zzper";

  // Merge back to one newest-first list (the client renders a single tab).
  // ISO dates compare correctly as strings; nulls sort last, created_at breaks ties.
  const confirmedRaw = [
    ...(confirmedReceivedRaw ?? []),
    ...(confirmedPaidRaw ?? []),
  ].sort((a, b) => {
    const ad = (a as { invoice_date: string | null }).invoice_date ?? "";
    const bd = (b as { invoice_date: string | null }).invoice_date ?? "";
    if (ad !== bd) return ad ? (bd ? bd.localeCompare(ad) : -1) : 1;
    const ac = (a as { created_at: string }).created_at ?? "";
    const bc = (b as { created_at: string }).created_at ?? "";
    return bc.localeCompare(ac);
  });

  // [BOEK-011] Base rows — cast through unknown (Supabase returns a wide union).
  // [IMPORT-MONITOR] Also omit `health` here: it is computed below, not selected.
  const pendingBase = (pendingRaw ?? []) as unknown as Omit<
    IncomingInvoiceRow,
    "folder_id" | "folder_name" | "health"
  >[];
  const ignoredBase = (ignoredRaw ?? []) as unknown as Omit<
    IncomingInvoiceRow,
    "folder_id" | "folder_name" | "health"
  >[];
  const confirmedBase = (confirmedRaw ?? []) as unknown as Omit<
    IncomingInvoiceRow,
    "folder_id" | "folder_name" | "health"
  >[];

  // [BOEK-011] Resolve folder PATH for each invoice — safe, never breaks the page.
  // 1. Get the folder_id for each linked document
  // 2. Load all the user's folders once
  // 3. Walk parent_id up to build the full path: "2026 / Q1 / maart / Facturen"
  const allDocIds = [...pendingBase, ...ignoredBase, ...confirmedBase]
    .map((inv) => inv.document_id)
    .filter((id): id is string => !!id);

  // document_id → folder_id
  const folderIdByDocId = new Map<string, string | null>();

  if (allDocIds.length > 0) {
    // [INBOX-CROWD-OUT] Chunked: the confirmed list can now hold hundreds of
    // rows, and supabase-js sends .in() filters in the URL — one giant id list
    // could exceed URL-length limits and silently drop every folder path.
    for (let i = 0; i < allDocIds.length; i += 150) {
      const { data: docs } = await supabase
        .from("documents")
        .select("id, folder_id")
        .in("id", allDocIds.slice(i, i + 150));

      for (const doc of (docs ?? []) as unknown as Array<{
        id: string;
        folder_id: string | null;
      }>) {
        folderIdByDocId.set(doc.id, doc.folder_id);
      }
    }
  }

  // De mappen zijn al binnen: ze zaten in de golf bovenaan, want ze hangen van niets af.

  const folderById = new Map<string, { name: string; parent_id: string | null }>();
  for (const f of (allFolders ?? []) as unknown as Array<{
    id: string;
    name: string;
    parent_id: string | null;
  }>) {
    folderById.set(f.id, { name: f.name, parent_id: f.parent_id });
  }

  // Build "2026 / Q1 / maart / Facturen" by walking up parent_id
  function buildFolderPath(folderId: string | null): string | null {
    if (!folderId) return null;
    const parts: string[] = [];
    let current: string | null = folderId;
    let guard = 0; // safety — never loop forever
    while (current && guard < 10) {
      const node = folderById.get(current);
      if (!node) break;
      parts.unshift(node.name);
      current = node.parent_id;
      guard++;
    }
    return parts.length > 0 ? parts.join(" / ") : null;
  }

  // Attach folder id + full path + [IMPORT-MONITOR] computed import health.
  const withFolder = (
    rows: Omit<IncomingInvoiceRow, "folder_id" | "folder_name" | "health">[]
  ): IncomingInvoiceRow[] =>
    rows.map((inv) => {
      const folderId = inv.document_id
        ? folderIdByDocId.get(inv.document_id) ?? null
        : null;
      return {
        ...inv,
        folder_id: folderId,
        folder_name: buildFolderPath(folderId),
        // [IMPORT-MONITOR] Part 1 — health from existing signals only (reads the
        // stored _safecore, else recomputes via the shared arithmetic gate; plus
        // the AI per-field confidence). Pure, read-time, no writes.
        // [BRIDGE-CREDITNOTA-SIGN] invoice_type routes a creditnota to the
        // sign-inverted gate — a clean negative creditnota reads "ready".
        health: classifyImportHealth({
          total_ex_btw: inv.total_ex_btw,
          btw_amount: inv.btw_amount,
          total_inc_btw: inv.total_inc_btw,
          invoice_date: inv.invoice_date,
          invoice_number: inv.invoice_number,
          invoice_type: inv.invoice_type,
          field_confidence: inv.field_confidence,
        }),
      };
    });

  const pendingInvoices = withFolder(pendingBase);
  const ignoredInvoices = withFolder(ignoredBase);
  const confirmedInvoices = withFolder(confirmedBase);

  // [READING-MEMORY] Ook al binnen — zie de golf bovenaan.

  // Resolved to a plain object here, not handed to the client as a Map: only the suppliers actually
  // sitting in the queue can produce a hint, so this ships a handful of sentences instead of the
  // owner's whole correction history.
  const readingHints: Record<string, string> = {};
  for (const inv of pendingInvoices) {
    const hint = readingHintFor(inv.client_name, readingMemory);
    if (hint) readingHints[vendorKey(inv.client_name)] = hint;
  }

  // ── [TARIEF-GEHEUGEN] Het tarief dat DEZE leverancier zelf altijd rekent ────────────────────
  //
  // 44 facturen in productie staan vast met excl. BTW 0 en BTW 0 tegenover een echt totaal:
  // € 49.963 aan inkoop waarop geen cent voorbelasting is geclaimd. safecore houdt ze terecht
  // tegen — hij weigert een uitsplitsing te boeken die hij niet gelezen heeft. Maar het antwoord
  // ligt vaak al in de administratie van de eigenaar zelf: ATAPACK rekende twaalf keer 21 %,
  // Sumer twaalf keer 9 %, W.KETELS vijfentwintig keer 9 %.
  //
  // Alleen VOOR DE LEVERANCIERS DIE NU IN DE WACHTRIJ STAAN, en alleen de drie bedragen — dit is
  // een voorstel op één scherm, geen tweede boekhouding. Enka Horeca krijgt hier niets: die mengt
  // 9 % en 21 % op één factuur, en vendor-vat-rate.ts weigert dan een tarief. Dat is de duurste
  // groep (13 facturen, € 18.698) en juist daarom moet hij leeg blijven — één tarief op een
  // gemengde factuur is een verkeerd getal in de btw-aangifte.
  const vendorRates: Record<string, { rate: number; basedOn: number; source?: 'history' | 'supplier' }> = {};
  {
    const wachtendeLeveranciers = [...new Set(
      pendingInvoices.map((i) => i.client_name).filter((n): n is string => typeof n === "string" && n.trim() !== ""),
    )];
    if (wachtendeLeveranciers.length > 0) {
      // [NO-SILENT-EMPTY] Mislukt deze lezing, dan blijft vendorRates leeg en toont het scherm
      // simpelweg geen voorstel — precies wat het vandaag ook doet. Er wordt niets beweerd op
      // grond van een lezing die niet gelukt is.
      // [IN-CHUNK] Gechunkt, want dit is een .in() op een lijst die met de wachtrij meegroeit. Een
      // ongechunkte variant sneuvelt voorbij een paar honderd namen op een 414 die supabase-js als
      // een gewone fout teruggeeft — en dan leest een MISLUKTE lezing als "geen geschiedenis", dus
      // verdwijnt het voorstel precies bij de eigenaar met de meeste leveranciers.
      const historie = await fetchAllRowsForIds<HistorieRij, string>(
        wachtendeLeveranciers,
        (chunk, from, to) => supabase
          .from("invoices")
          .select("client_name, total_ex_btw, btw_amount, total_inc_btw")
          .eq("receiver_id", user.id)
          .eq("direction", "incoming")
          .in("client_name", chunk)
          .in("status", ["received", "paid"])
          .range(from, to) as unknown as PromiseLike<{ data: HistorieRij[] | null; error: { message: string } | null }>,
      );
      const perLeverancier = new Map<string, RatedInvoice[]>();
            for (const r of historie) {
        const k = vendorKey(r.client_name);
        if (!k) continue;
        const lijst = perLeverancier.get(k) ?? [];
        lijst.push({ totalExBtw: r.total_ex_btw, btwAmount: r.btw_amount, totalIncBtw: r.total_inc_btw });
        perLeverancier.set(k, lijst);
      }
      for (const [k, rijen] of perLeverancier) {
        const tarief = deriveVendorRate(rijen);
        if (tarief) vendorRates[k] = { ...tarief, source: 'history' };
      }
    }
    // [LEVERANCIER-STANDAARD] Wat de eigenaar zelf op de leverancier heeft gezet, wint van wat de
    // geschiedenis suggereert: een besluit boven een statistiek. Alleen de rijen mét een vast
    // tarief worden gelezen, en een mislukte lezing laat de afgeleide tarieven gewoon staan.
    try {
      const { data: vaste } = await supabase
        .from("suppliers")
        .select("name, default_btw_rate")
        .eq("user_id", user.id)
        .not("default_btw_rate", "is", null);
      for (const s of (vaste ?? []) as { name: string | null; default_btw_rate: number | null }[]) {
        const k = vendorKey(s.name);
        if (k && s.default_btw_rate !== null && wachtendeLeveranciers.some((n) => vendorKey(n) === k)) {
          vendorRates[k] = { rate: s.default_btw_rate, basedOn: 0, source: 'supplier' };
        }
      }
    } catch (e) {
      console.error("[LEVERANCIER-STANDAARD] default rates could not be read — history rates stand", e);
    }
  }

  const connectionStatus = {
    connected: !!connection,
    provider: (connection?.provider ?? null) as 'gmail' | 'outlook' | null,
    email: (connection?.email ?? null) as string | null,
    connected_at: connection?.connected_at ?? null,
    // [EMAIL-HEALTH] true = the OAuth grant died; the automatic import has stopped and the owner
    // must reconnect. Surfaced as a banner so the connection can no longer rot silently green.
    needs_reauth: connection?.needs_reauth ?? false,
    pending_count: pendingInvoices.length,
    // [MAILBOX-WAAR] De tweede aanbieder, als het plan er ruimte voor heeft. Op de SERVER beslist,
    // met dezelfde grens die /api/email/connect handhaaft en dezelfde die op /eerlijk-gebruik
    // staat — anders biedt het scherm een knop aan die de deur weigert, en dat is erger dan geen
    // knop. `null` = niets aanbieden.
    other_provider: (await (async () => {
      const taken = new Set(connections.map((c) => c.provider));
      const free = (["gmail", "outlook"] as const).find((p) => !taken.has(p));
      if (!free || taken.size === 0) return null;
      const plan = await planForUser(supabase, user.id);
      const limit = plan === "free" ? fairUseLimit("mailboxes").free : fairUseLimit("mailboxes").plus;
      return taken.size < limit ? free : null;
    })()) as "gmail" | "outlook" | null,
  };

  return (
    <IncomingInvoicesClient
      initialInvoices={pendingInvoices}
      ignoredInvoices={ignoredInvoices}
      confirmedInvoices={confirmedInvoices}
      connectionStatus={connectionStatus}
      userRole={userRole}
      readingHints={readingHints}
      vendorRates={vendorRates}
      readFailed={readFailed}
      suppliers={suppliers}
      suppliersUnavailable={!!suppliersErr}
    />
  );
}