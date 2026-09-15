// src/lib/account-export.ts
// [BOEK-032] Account data export (GDPR) — builds a ZIP of the user's own data.
//
// Server-only. Bundles:
//   facturen.csv          → all invoices (user as sender or receiver), via export.ts
//   btw-aangiftes.csv     → every FILED quarter, frozen as declared (see [EXPORT-FILED]); when
//                           that ledger could not be read, a NIET-GELEZEN note replaces it
//   bestanden/...         → the user's actual Storage files (bucket "documents")
//   profiel.json          → the user's profile record (verbatim)
//   manifest.json         → summary + any skipped files (transparency pillar)
//
// Ownership: this file is owned by [BOEK-032]. export.ts is owned by B.14/B.20 —
// we CALL its helpers (toExportRowFull, invoicesToCsv); we never modify it.
//
// Security: the caller (api/account/delete) MUST pass a userId taken from a
// VERIFIED session. The pipeline (service_role) client bypasses RLS, so every
// query here is explicitly scoped to that userId (handoff lesson 3).

import JSZip from "jszip";
import type { PipelineClient } from "./supabase-pipeline";
import { fetchAllRows, fetchAllRowsForIds } from "./supabase-paginate";
import { ownedStoragePath } from "./storage-path";
import { toExportRowFull, invoicesToCsv, fmtAmountNL, type InvRow } from "./export";
import { csvCell } from "./csv-safe";
import { isMissingRelation } from "./pg-missing";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AccountExportSummary {
  invoiceCount: number;
  fileCount: number; // files successfully included
  bankCount: number;
  cashCount: number;
  /**
   * [KAS-SPOOR] Rows in the drawer's audit trail: removed movements and beginsaldo changes.
   *
   * Counted separately from cashCount because it answers a different question. cashCount says how
   * much the cash book holds; this says how much happened TO it — and for the removals it is the
   * only surviving record, since a cash_entries delete destroys the row.
   */
  cashTrailCount: number;
  turnoverCount: number;
  messageCount: number;
  btwFilingCount: number;
  /**
   * [EXPORT-FILED] FALSE when the filed BTW-aangiftes could not be read. Mirrors
   * `pinLedgerAvailable` in compute-result-range: losing this ledger can only make the export
   * look emptier than the account is, so the difference between "filed nothing" and "we could
   * not look" has to travel with the result instead of collapsing into a count of 0.
   */
  btwFilingsAvailable: boolean;
  /**
   * [EXPORT-REGISTERS] Row count per register that went into the ZIP, keyed by its FILE name.
   * Keyed by file rather than by table so the manifest and the archive cannot drift: whoever
   * opens the ZIP in 2032 reads a number next to a file they can point at.
   */
  registerCounts: Record<string, number>;
  skipped: { name: string; reason: string }[];
  generatedAt: string; // ISO
}

/**
 * [EXPORT-FILED] One filed BTW-aangifte, as frozen in `btw_filings` when the owner marked the
 * quarter as sent. Field names mirror the database columns verbatim — those are Dutch because
 * renaming a column is a migration, not a rename (AGENTS.md).
 *
 * A `numeric` column arrives from PostgREST as a JSON number, but a driver or a future column
 * change can hand back a string; every amount is coerced at the edge rather than trusted.
 */
export interface BtwFilingRow {
  year: number;
  quarter: number;
  filed_at: string | null;
  omzet: number | string | null;
  kosten: number | string | null;
  btw_verschuldigd: number | string | null;
  btw_voorbelasting: number | string | null;
  btw_saldo: number | string | null;
}

export interface AccountExportResult {
  zipBytes: Buffer;
  summary: AccountExportSummary;
}

/** A file already downloaded from Storage, ready to drop into the ZIP. */
export interface ExportFile {
  path: string; // documents.file_url (raw path, e.g. "<userId>/2026/Q1/...pdf")
  name: string; // documents.file_name (display name, used as fallback)
  bytes: Uint8Array;
}

/**
 * [EXPORT-REGISTERS] The tables an owner FILLED, which the export left behind.
 *
 * What was in the ZIP before this: invoices as a CSV of their headers, the documents, the profile,
 * and the four ledgers. What was not: the invoice LINES, the customer register, the supplier
 * register, the price list, the hours, the vehicles, the reminder trail, and the links that say
 * which bank payment settled which invoice.
 *
 * That is not a smaller export, it is a different claim. facturen.csv carries a total and a client
 * NAME; the lines that make up that total, and the address and btw-nummer the invoice was actually
 * addressed to, live in invoice_lines and clients. An owner who leaves BoekBrug with this ZIP can
 * see WHAT was invoiced and to whom by name, and can reconstruct nothing — not one invoice, not
 * one reconciliation. The bewaarplicht that manifest.json hands back to them (art. 52 AWR, seven
 * years) is a duty to keep an administration that can be inspected, and headers are not one.
 *
 * It matters more than it looks because /api/account/delete GATES deletion on this export having
 * been made and confirmed. So the app's own answer to "take your data and go" was the incomplete
 * file, and taking it was the step that unlocked destroying the rest.
 *
 * Everything here is keyed on user_id, except invoice_lines, which hangs off the owner's invoices.
 * Verbatim JSON like the ledgers above: a column added later still leaves with the account.
 */
export interface ExportRegisters {
  /** invoice_lines for the owner's own invoices — what each invoice actually says. */
  invoiceLines: unknown[];
  /** clients — the customer register: address, e-mail, KVK/BTW, payment term. */
  clients: unknown[];
  /** suppliers — the supplier register, with the IBANs the matcher books on. */
  suppliers: unknown[];
  /** supplier_aliases — the other names one supplier writes on its invoices. */
  supplierAliases: unknown[];
  /** supplier_iban_history — account numbers the owner replaced on a supplier, and when. */
  supplierIbanHistory: unknown[];
  /** articles — the owner's own price list. */
  articles: unknown[];
  /** time_entries — hours worked, invoiced and not yet invoiced. */
  timeEntries: unknown[];
  /** vehicles — the cars behind the kilometeradministratie. */
  vehicles: unknown[];
  /** assets — the bedrijfsmiddelen register; each row moves the year's winst through its depreciation. */
  assets: unknown[];
  /** asset_dismissals — the owner's "nee, dit is inkoop" answers, so a candidate is never asked twice. */
  assetDismissals: unknown[];
  /** invoice_reminders — when each reminder went out. The WIK trail; nothing else records it. */
  invoiceReminders: unknown[];
  /** bank_tx_invoices — which bank line paid which invoice. The reconciliation itself. */
  bankInvoiceLinks: unknown[];
  /** folders — how the owner organised their own documents. */
  folders: unknown[];
  /** counterpart_memory — the categorisation the owner taught the app, answer by answer. */
  counterpartMemory: unknown[];
  /** email_sender_rules — "mail from this sender is always an invoice", set by the owner. */
  emailSenderRules: unknown[];
  /** email_skipped_attachments — what the mailbox delivered and the app did NOT import, and why. */
  emailSkipped: unknown[];
  /** invoice_counters — where the owner's invoice numbering stands. Continuity after leaving. */
  invoiceCounters: unknown[];
  /** pay_bundles / pay_bundle_invoices — the payment batches the owner assembled. */
  payBundles: unknown[];
  payBundleInvoices: unknown[];
  /** feedback — what the owner wrote to us. Their words, so theirs to take. */
  feedback: unknown[];
}

/** Empty registers — the shape, with nothing in it. Used as the default in assemble. */
export const EMPTY_REGISTERS: ExportRegisters = {
  invoiceLines: [], clients: [], suppliers: [], supplierAliases: [], supplierIbanHistory: [], articles: [],
  timeEntries: [], vehicles: [], assets: [], assetDismissals: [], invoiceReminders: [], bankInvoiceLinks: [],
  folders: [], counterpartMemory: [], emailSenderRules: [], emailSkipped: [],
  invoiceCounters: [], payBundles: [], payBundleInvoices: [], feedback: [],
};

interface AssembleInput {
  userId: string;
  profile: unknown; // profile row, dumped verbatim as JSON
  invoices: InvRow[];
  files: ExportFile[];
  // [EXPORT-COMPLETE] The rest of the user's own data, dumped verbatim as JSON so the
  // GDPR export actually contains "al je gegevens" — not just invoices/docs/profile.
  bankTransactions?: unknown[];
  cashEntries?: unknown[];
  // [KAS-SPOOR] The drawer's audit trail. The one ledger whose rows are not the whole story: a
  // cash_entries delete is a HARD delete and a cash movement has no source document to re-read, so
  // these rows are the only place a removed movement still exists. See the read in
  // buildAccountExport for why only the three cash.* actions travel.
  cashTrail?: unknown[];
  dailyTurnover?: unknown[];
  // [KASSA] The per-sale detail of a shop without a till. It is NOT a money source — the engines
  // read the aggregated daily_turnover row — but it is the ONLY record of what was actually sold,
  // because there is no Z-report file behind it the way there is for a till shop. Leaving it out
  // would ship an owner "al je gegevens" without the thing his day is made of.
  tillSales?: unknown[];
  /** Defaults to true. Pass false when the till_sales read failed — see the summary field. */
  tillSalesAvailable?: boolean;
  messages?: unknown[];
  // [EXPORT-FILED] The filed BTW-aangiftes. Typed structurally, so a `select("*")` row keeps
  // any extra column it carries: the CSV reads the known fields, the JSON dumps all of them.
  btwFilings?: BtwFilingRow[];
  /** Defaults to true. Pass false when the btw_filings read failed — see the summary field. */
  btwFilingsAvailable?: boolean;
  /** [EXPORT-REGISTERS] The tables the owner filled. Defaults to empty. */
  registers?: Partial<ExportRegisters>;
  skipped?: { name: string; reason: string }[];
}

/**
 * [EXPORT-FILED] Shipped INSTEAD of the CSV when the filings could not be read.
 *
 * An empty btw-aangiftes.csv is not a neutral fallback: it states "this account filed nothing",
 * which is a claim about someone's tax history that a failed read does not license us to make.
 * Dutch, because whoever opens this ZIP in 2032 is the owner, their accountant or an inspector.
 */
// [KASSA] Same shape and same reason as the note below it: an empty file would CLAIM that nothing
// was ever rung up, and a failed read has established no such thing.
const TILL_SALES_UNREADABLE_NOTE = [
  "Je kassaverkopen konden bij het maken van deze export niet worden gelezen.",
  "",
  "Daarom staat er GEEN leeg bestand in deze export. Een leeg bestand zou betekenen dat je nooit",
  "iets op de kassa hebt aangeslagen, en dat is op dit moment niet vastgesteld.",
  "",
  "Je dagomzet zelf staat wel in deze export (dagomzet.json) — dat is wat er in je boekhouding en",
  "je BTW-aangifte telt. Dit bestand gaat over de losse verkopen daarachter.",
  "",
  "Wat je kunt doen: maak de export later opnieuw, of vraag je verkopen op via support@boekbrug.nl.",
  "",
].join("\n");

const BTW_FILINGS_UNREADABLE_NOTE = [
  "Je ingediende BTW-aangiftes konden bij het maken van deze export niet worden gelezen.",
  "",
  "Daarom staat er GEEN leeg overzicht in deze export. Een leeg bestand zou betekenen dat je",
  "niets hebt ingediend, en dat is op dit moment niet vastgesteld.",
  "",
  "Wat je kunt doen: maak de export later opnieuw, of vraag je ingediende aangiftes op via",
  "support@boekbrug.nl.",
  "",
  "Let op: je bewaarplicht van 7 jaar (art. 52 AWR) rust op jou als ondernemer en loopt door",
  "nadat je stopt met BoekBrug.",
  "",
].join("\r\n");

// ─── Helpers (pure) ─────────────────────────────────────────────────────────────

/** "2026-Q2" from an ISO date; "" when missing/invalid. UTC for determinism. */
export function periodFromDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

/**
 * [EXPORT-FILED] The filed BTW-aangiftes as a CSV a human can open.
 *
 * Why this file exists at all: `btw_filings` was in no export path. An owner could take their
 * invoices, bank, kas and dagomzet with them but NOT the one artefact a Belastingdienst controle
 * actually asks for — what they declared for a given quarter, and when. The live figures cannot
 * stand in for it: a late invoice retroactively moves a past quarter, which is the entire reason
 * the frozen snapshot exists (see btw_filings.sql). Recomputing it later answers a different
 * question than "what did you send".
 *
 * CSV rather than a JSON dump because the reader here is the owner, their accountant or an
 * inspector — the same audience and the same shape as facturen.csv. The verbatim JSON ships
 * alongside it, so a column added to the table later cannot be lost by this mapper going stale.
 *
 * Dutch headers and Dutch amount formatting: this is content a Dutch entrepreneur reads, not
 * code (AGENTS.md). Sorted by period so the file is deterministic whatever order it was read in.
 */
export function btwFilingsToCsv(rows: BtwFilingRow[]): string {
  const headers = [
    "Jaar",
    "Kwartaal",
    "Ingediend op",
    "Omzet",
    "Kosten",
    "BTW verschuldigd",
    "BTW voorbelasting",
    "BTW saldo",
  ];

  // An amount that is null, or that does not parse as a number, becomes "" — never a silent 0,00,
  // which would read as "declared nothing" instead of "not recorded".
  const amount = (v: number | string | null): string => {
    if (v == null || v === "") return "";
    const n = Number(v);
    return Number.isFinite(n) ? fmtAmountNL(n) : "";
  };

  const sorted = [...rows].sort(
    (a, b) => a.year - b.year || a.quarter - b.quarter,
  );

  const lines = [
    headers.map((h) => csvCell(h)).join(";"),
    ...sorted.map((r) =>
      [
        r.year,
        `Q${r.quarter}`,
        r.filed_at ?? "",
        amount(r.omzet),
        amount(r.kosten),
        amount(r.btw_verschuldigd),
        amount(r.btw_voorbelasting),
        amount(r.btw_saldo),
      ]
        .map((v) => csvCell(v))
        .join(";"),
    ),
  ];

  return lines.join("\r\n");
}

/** In-ZIP path for a storage file: strip "<userId>/" prefix, keep structure. */
export function zipPathForFile(userId: string, file: ExportFile): string {
  const prefix = `${userId}/`;
  const rel = file.path.startsWith(prefix)
    ? file.path.slice(prefix.length)
    : file.name;
  return `bestanden/${rel}`;
}

// ─── Assembly (no network — fully node-testable) ────────────────────────────────

/**
 * Build the export ZIP from already-fetched data. Deterministic & testable.
 */
export async function assembleAccountExportZip(
  input: AssembleInput,
): Promise<AccountExportResult> {
  const { userId, profile, invoices, files } = input;
  const bankTransactions = input.bankTransactions ?? [];
  const cashEntries = input.cashEntries ?? [];
  const cashTrail = input.cashTrail ?? [];
  const dailyTurnover = input.dailyTurnover ?? [];
  const tillSales = input.tillSales ?? [];
  const tillSalesAvailable = input.tillSalesAvailable ?? true;
  const messages = input.messages ?? [];
  const btwFilings = input.btwFilings ?? [];
  const btwFilingsAvailable = input.btwFilingsAvailable ?? true;
  const registers: ExportRegisters = { ...EMPTY_REGISTERS, ...(input.registers ?? {}) };
  const skipped = [...(input.skipped ?? [])];
  const zip = new JSZip();

  // 1. facturen.csv — built via export.ts (called, not modified).
  //    BOM prepended so Excel NL reads UTF-8 correctly (downloadCsv does this
  //    in the browser; here we are server-side so we add it ourselves).
  const rows = invoices.map((inv) =>
    toExportRowFull(inv, periodFromDate(inv.invoice_date)),
  );
  zip.file("facturen.csv", "\uFEFF" + invoicesToCsv(rows));

  // 1b. [EXPORT-FILED] btw-aangiftes.csv — the filed quarters, frozen as declared. Same BOM, for
  //     the same reason: this is opened in a Dutch Excel. Written whenever the read SUCCEEDED,
  //     including when it returned nothing: "filed nothing" is a real answer and belongs in the
  //     export as a header-only file, because an absent file cannot be told apart from an export
  //     that dropped it. A FAILED read is the one case that must NOT produce that file — it would
  //     put a claim about someone's tax history on a fact we do not have.
  if (btwFilingsAvailable) {
    zip.file("btw-aangiftes.csv", "\uFEFF" + btwFilingsToCsv(btwFilings));
  } else {
    zip.file("BTW-AANGIFTES-NIET-GELEZEN.txt", BTW_FILINGS_UNREADABLE_NOTE);
  }

  // 2. profiel.json — the user's profile record, verbatim.
  zip.file("profiel.json", JSON.stringify(profile ?? null, null, 2));

  // 3. bestanden/ — the user's actual Storage files.
  let fileCount = 0;
  for (const f of files) {
    zip.file(zipPathForFile(userId, f), f.bytes);
    fileCount++;
  }

  // 4. The rest of the user's own ledgers/data, verbatim JSON, so the export is
  //    genuinely "al je gegevens" (not just invoices/docs/profile).
  zip.file("bank.json", JSON.stringify(bankTransactions, null, 2));
  zip.file("kas.json", JSON.stringify(cashEntries, null, 2));
  // [KAS-SPOOR] Next to kas.json, never merged into it: these are not cash entries, they are the
  // record of what happened TO them — movements that were removed (which exist nowhere else, the
  // delete is hard) and every change to the beginsaldo, which shifts every eindsaldo in the whole
  // history and appears in profiel.json only as its current value.
  zip.file("kas-spoor.json", JSON.stringify(cashTrail, null, 2));
  zip.file("dagomzet.json", JSON.stringify(dailyTurnover, null, 2));
  // [KASSA] Beside the day it aggregates into, never instead of it.
  if (tillSalesAvailable) {
    zip.file("kassaverkopen.json", JSON.stringify(tillSales, null, 2));
  } else {
    zip.file("KASSAVERKOPEN-NIET-GELEZEN.txt", TILL_SALES_UNREADABLE_NOTE);
  }
  zip.file("berichten.json", JSON.stringify(messages, null, 2));

  // 4b. [EXPORT-REGISTERS] The tables the owner FILLED — see the type for why their absence made
  //     this a different export rather than a smaller one. Dutch file names, like every other file
  //     in this ZIP: the reader is the owner, their accountant, or an inspector.
  //
  //     Written unconditionally, empty list and all. An empty registers file is an honest answer
  //     here in a way the btw-aangiftes one is not: the read THREW if it failed (readAll above),
  //     so reaching this line means the answer is known. The absence of a FILE is what nobody can
  //     interpret — that is the rule the whole module is built on.
  const REGISTER_FILES: Array<[keyof ExportRegisters, string]> = [
    ["invoiceLines", "factuurregels.json"],
    ["clients", "klanten.json"],
    ["suppliers", "leveranciers.json"],
    ["supplierAliases", "leveranciers-schrijfwijzen.json"],
    ["supplierIbanHistory", "leveranciers-oude-rekeningnummers.json"],
    ["articles", "artikelen.json"],
    ["timeEntries", "uren.json"],
    ["vehicles", "voertuigen.json"],
    ["assets", "bedrijfsmiddelen.json"],
    ["assetDismissals", "bedrijfsmiddelen-antwoorden.json"],
    ["invoiceReminders", "herinneringen.json"],
    ["bankInvoiceLinks", "bank-factuur-koppelingen.json"],
    ["folders", "mappen.json"],
    ["counterpartMemory", "tegenpartij-geheugen.json"],
    ["emailSenderRules", "mail-afzenderregels.json"],
    ["emailSkipped", "mail-niet-ingelezen.json"],
    ["invoiceCounters", "factuurnummering.json"],
    ["payBundles", "betaalbundels.json"],
    ["payBundleInvoices", "betaalbundel-facturen.json"],
    ["feedback", "mijn-feedback.json"],
  ];
  const registerCounts: Record<string, number> = {};
  for (const [key, fileName] of REGISTER_FILES) {
    const rows = registers[key];
    zip.file(fileName, JSON.stringify(rows, null, 2));
    registerCounts[fileName] = rows.length;
  }
  // [EXPORT-FILED] Verbatim alongside the CSV: the CSV is what a human reads, this is the
  // guarantee that a column added to btw_filings later still leaves the account with it. Same
  // rule as the CSV — an unreadable ledger ships as no file, never as an empty one.
  if (btwFilingsAvailable) {
    zip.file("btw-aangiftes.json", JSON.stringify(btwFilings, null, 2));
  }

  // 5. manifest.json — transparency: what's inside + what was skipped.
  const summary: AccountExportSummary = {
    invoiceCount: invoices.length,
    fileCount,
    bankCount: bankTransactions.length,
    cashCount: cashEntries.length,
    cashTrailCount: cashTrail.length,
    turnoverCount: dailyTurnover.length,
    messageCount: messages.length,
    btwFilingCount: btwFilingsAvailable ? btwFilings.length : 0,
    btwFilingsAvailable,
    registerCounts,
    skipped,
    generatedAt: new Date().toISOString(),
  };
  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        beschrijving:
          "Export van je BoekBrug-account: facturen met hun regels, je klanten- en leveranciersbestand, " +
          "ingediende BTW-aangiftes, documenten, profiel, bank (met de koppelingen naar je facturen), " +
          "kas (met het spoor van verwijderde kasboekingen en beginsaldo-wijzigingen), dagomzet, uren, " +
          "artikelen, voertuigen, herinneringen en berichten.",
        bewaarplicht:
          "Je bewaarplicht van 7 jaar (art. 52 AWR) rust op jou als ondernemer en loopt door nadat je stopt met BoekBrug. Bewaar deze export.",
        gegenereerd_op: summary.generatedAt,
        aantal_facturen: summary.invoiceCount,
        aantal_bestanden: summary.fileCount,
        aantal_banktransacties: summary.bankCount,
        aantal_kasboekingen: summary.cashCount,
        // [KAS-SPOOR] Wat er MET je kasboekingen is gebeurd: verwijderde boekingen (die staan
        // nergens anders — een kasregel wordt hard verwijderd) en elke wijziging van het beginsaldo.
        aantal_kas_spoorregels: summary.cashTrailCount,
        aantal_dagomzetdagen: summary.turnoverCount,
        aantal_berichten: summary.messageCount,
        aantal_btw_aangiftes: summary.btwFilingCount,
        // [EXPORT-FILED] false ⇒ het aantal hierboven is géén nul-meting maar een mislukte lezing.
        btw_aangiftes_gelezen: summary.btwFilingsAvailable,
        // [EXPORT-REGISTERS] Per bestand het aantal regels dat erin ging. Nul is hier een echt
        // antwoord: een mislukte lezing had de export laten falen, niet leeggemaakt.
        aantallen_per_bestand: summary.registerCounts,
        // Wat er BEWUST niet in zit, en waarom — zodat een leeg vakje geen open vraag wordt.
        niet_meegeleverd: {
          afgeleide_overzichten:
            "Bestanden die de app zelf uitrekent uit wat hierboven staat (dagstaten, " +
            "afletteringsoverzichten, kwartaalpakketten) zitten er niet in: ze zijn geen aparte " +
            "gegevens, ze zijn een weergave van deze.",
          logboek:
            "Het volledige audit-logboek zit er niet in; alleen het kasspoor, omdat een " +
            "verwijderde kasboeking nergens anders meer bestaat. De rest van het logboek is een " +
            "beveiligingsregistratie met IP-adressen, en dat is een aparte vraag met een eigen " +
            "antwoord — stel hem via privacy@boekbrug.nl.",
        },
        overgeslagen_bestanden: summary.skipped,
      },
      null,
      2,
    ),
  );

  const zipBytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });

  return { zipBytes, summary };
}

// ─── Orchestrator (fetch + parallel download, then assemble) ────────────────────

// [EXPORT-REGISTERS] `id` leads the list, and it is not cosmetic: invoice_lines is the one table
// in this export that is not keyed on user_id. Without the owner's invoice ids there is no way to
// ask for the lines, which is a large part of why they were never in the ZIP.
const INVOICE_FIELDS =
  "id, invoice_number, client_name, client_email, client_address, " +
  "client_postal_code, client_city, status, direction, total_ex_btw, " +
  "btw_amount, total_inc_btw, invoice_date, due_date, created_at, " +
  "invoice_type";

/**
 * Build the full account export ZIP for a VERIFIED userId.
 * `supabase` must be a service_role pipeline client; every query is explicitly
 * scoped to `userId` (service_role bypasses RLS — handoff lesson 3).
 */
export async function buildAccountExportZip(args: {
  userId: string;
  supabase: PipelineClient;
}): Promise<AccountExportResult> {
  const { userId, supabase } = args;

  // Profile (the user's own record).
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  // Invoices where the user is sender OR receiver.
  // [EXPORT-PAGINATE] Paged. Every read in this file already refuses to swallow an ERROR
  // ("must not silently drop a whole ledger from a GDPR export" — see below), but none of them
  // handled TRUNCATION, and PostgREST caps a response at ~1000 rows without saying so. In an
  // export whose entire purpose is completeness that is the same harm arriving by the quieter
  // door: the ZIP is delivered, it looks whole, and the ledger simply stops at a thousand.
  const invoices = (await fetchAllRows((from, to) =>
    supabase
      .from("invoices")
      .select(INVOICE_FIELDS)
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .order("id", { ascending: true })
      .range(from, to),
  ).catch((e) => {
    throw new Error(`[BOEK-032] invoices query failed: ${e instanceof Error ? e.message : String(e)}`);
  })) as unknown as InvRow[];

  // Document metadata.
  const docData = await fetchAllRows<{ file_name: string; file_url: string }>((from, to) =>
    supabase
      .from("documents")
      .select("file_name, file_url")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, to),
  ).catch((e) => {
    throw new Error(`[BOEK-032] documents query failed: ${e instanceof Error ? e.message : String(e)}`);
  });
  const docs = docData ?? [];

  // Download files IN PARALLEL (perf — Tech Lead note). A single failed file is
  // recorded as "skipped" rather than failing the whole GDPR export.
  //
  // NOTE (deferred, measurement-first): this holds every file + the ZIP in
  // memory at once. If profiling shows large accounts struggle, switch to
  // chunked/streamed downloads. Not optimizing before measurement.
  const downloaded = await Promise.all(
    docs.map(async (d) => {
      // [SEC-STORAGE-PATH] The row proves the RECORD is this user's; it does not prove the record
      // POINTS at their bytes. `file_url` is ordinary text on a row the owner may UPDATE
      // (documents_update_own is a whole-row policy), and `supabase` here is service_role — which
      // bypasses the bucket policy that stops a session client reading another tenant's folder.
      // Without this line, pasting another owner's key onto one's own document row and then asking
      // for the AVG-export downloaded their file into the requester's ZIP.
      //
      // Refused rather than failed: an unattributable key is skipped like any unreadable file, and
      // the export already discloses every skip below, so the owner is told rather than quietly
      // handed a shorter ZIP.
      const path = ownedStoragePath(d.file_url, userId);
      if (!path) {
        return {
          ok: false as const,
          name: d.file_name,
          reason: "overgeslagen — dit bestand hoort niet bij dit account",
        };
      }
      try {
        const { data, error } = await supabase.storage
          .from("documents")
          .download(path);
        if (error || !data) {
          return {
            ok: false as const,
            name: d.file_name,
            reason: error?.message ?? "leeg bestand",
          };
        }
        const bytes = new Uint8Array(await data.arrayBuffer());
        return {
          ok: true as const,
          file: { path, name: d.file_name, bytes },
        };
      } catch (e) {
        return {
          ok: false as const,
          name: d.file_name,
          reason: e instanceof Error ? e.message : "downloadfout",
        };
      }
    }),
  );

  const files: ExportFile[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const r of downloaded) {
    if (r.ok) files.push(r.file);
    else skipped.push({ name: r.name, reason: r.reason });
  }

  // [EXPORT-COMPLETE] The remaining owner-scoped data, so the ZIP is genuinely complete.
  // Each scoped to this userId (service_role bypasses RLS). A query error must not silently
  // drop a whole ledger from a GDPR export → throw (the caller surfaces it), never []-swallow.
  // [EXPORT-PAGINATE] …and truncation is the other way to lose one. These four were plain
  // .select("*") reads, so an owner past a thousand bank lines, cash entries, till days or
  // messages received an export that stopped there and said nothing — the ledger the sentence
  // above promises never to drop, dropped by the ~1000-row cap instead of by an error.
  // fetchAllRows throws on a read error, which keeps that promise intact too.
  const readAll = async <T,>(label: string, build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> => {
    try {
      return await fetchAllRows<T>(build);
    } catch (e) {
      throw new Error(`[BOEK-032] ${label} query failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  // [KAS-SPOOR] …and the drawer's own trail, which is the ONE ledger where the rows are not the
  // whole story.
  //
  // Every other table in this export keeps its history inside itself: an archived invoice is still a
  // row with a status, a bank line is never destroyed, a turnover day that was removed can be
  // re-imported from the Z-report it came from. A cash_entries delete is a HARD delete, and a cash
  // movement has no source document to re-read — the owner typed it. So the audit row is the only
  // place a removed movement still exists, and an export that ships kas.json without it hands the
  // owner a cash book that cannot answer what the app itself now answers on screen and in the
  // accountant's quarterly sheet.
  //
  // Which is exactly what this file's own promise is about: an owner "could take their invoices,
  // bank, kas and dagomzet with them" — and the kas they took was silently missing the lines that
  // were taken out of it. The beginsaldo history belongs here for the same reason: profiel.json
  // carries the CURRENT float, and that one number shifts every eindsaldo in the whole history.
  //
  // Only the three cash.* actions. Not the rest of audit_logs: this is not "give the owner the log",
  // it is "an exported ledger must be complete", and the completeness gap exists only where rows can
  // vanish. A wider dump is a separate decision with its own privacy questions (ip_address, seven
  // years of every action) and it does not belong inside a fix for this one.
  const [bankRows, cashRows, turnoverRows, msgRows, cashTrailRows] = await Promise.all([
    readAll("bank_transactions", (from, to) =>
      supabase.from("bank_transactions").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    // [KAS-ZACHT] The ONE cash read in the app that deliberately does NOT filter out removed
    // movements. Everywhere else a soft-deleted row counts in nothing; here it must be PRESENT, with
    // its deleted_at visible, because this is the export of "al je gegevens" and a file that silently
    // drops rows is the exact harm the rest of this module is written against. select("*") carries
    // the column, so the reader can see which lines were removed and when.
    readAll("cash_entries", (from, to) =>
      supabase.from("cash_entries").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    readAll("daily_turnover", (from, to) =>
      supabase.from("daily_turnover").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    readAll("messages", (from, to) =>
      supabase.from("messages").select("*").or(`sender_id.eq.${userId},receiver_id.eq.${userId}`).order("id", { ascending: true }).range(from, to)),
    // Held to the same rule as the four above: a failed read THROWS rather than shipping an empty
    // list, because "no movement was ever removed from this cash book" is a claim, and an export
    // that makes it on the strength of a failed query is the harm this whole file is written against.
    readAll("audit_logs (kas)", (from, to) =>
      supabase.from("audit_logs")
        .select("action, created_at, entity_id, old_value, new_value")
        .eq("user_id", userId)
        .in("action", ["cash.entry_added", "cash.entry_removed", "cash.opening_balance_set"])
        .order("id", { ascending: true }).range(from, to)),
  ]);

  // [EXPORT-REGISTERS] The tables the owner filled. Same rule as the ledgers above: a failed read
  // THROWS. An export that quietly ships without someone's customer register is the harm this whole
  // file is written against, and it is worse here than elsewhere because /api/account/delete treats
  // a confirmed export as permission to destroy the original.
  //
  // Every one is scoped to userId except invoice_lines, which hangs off the owner's own invoice ids
  // — chunked, because an owner with thousands of invoices cannot ask for them in one `in()`.
  const invoiceIds = invoices
    .map((inv) => (inv as unknown as { id?: string | null }).id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const [
    invoiceLineRows, clientRows, supplierRows, supplierAliasRows, supplierIbanHistoryRows, articleRows,
    timeEntryRows, vehicleRows, assetRows, assetDismissalRows, reminderRows, bankLinkRows, folderRows, memoryRows,
    senderRuleRows, skippedMailRows, counterRows, bundleRows, bundleInvoiceRows, feedbackRows,
  ] = await Promise.all([
    invoiceIds.length === 0
      ? Promise.resolve([] as unknown[])
      : (async () => {
          try {
            return await fetchAllRowsForIds<unknown, string>(invoiceIds, (chunk, from, to) =>
              supabase.from("invoice_lines").select("*").in("invoice_id", chunk)
                .order("id", { ascending: true }).range(from, to));
          } catch (e) {
            throw new Error(`[BOEK-032] invoice_lines query failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        })(),
    readAll("clients", (from, to) =>
      supabase.from("clients").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    readAll("suppliers", (from, to) =>
      supabase.from("suppliers").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    readAll("supplier_aliases", (from, to) =>
      supabase.from("supplier_aliases").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    readAll("supplier_iban_history", (from, to) =>
      supabase.from("supplier_iban_history").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    readAll("articles", (from, to) =>
      supabase.from("articles").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    readAll("time_entries", (from, to) =>
      supabase.from("time_entries").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    readAll("vehicles", (from, to) =>
      supabase.from("vehicles").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    readAll("assets", (from, to) =>
      supabase.from("assets").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    readAll("asset_dismissals", (from, to) =>
      supabase.from("asset_dismissals").select("*").eq("user_id", userId).order("invoice_id", { ascending: true }).range(from, to)),
    readAll("invoice_reminders", (from, to) =>
      supabase.from("invoice_reminders").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    // [TOEKENNING] Waarom dit account meer had dan het gratis plan: de welkomstperiode, een pilot,
    // een verlenging — met reden en einddatum. Het gaat OVER hem, dus het gaat mee. Er staat geen
    // bedrag in en niets wat een ander account raakt; wie het weglaat, beweert dat onze
    // commerciële beslissingen over hem hem niet aangaan.
    readAll("plan_grants", (from, to) =>
      supabase.from("plan_grants").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    readAll("bank_tx_invoices", (from, to) =>
      supabase.from("bank_tx_invoices").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    readAll("folders", (from, to) =>
      supabase.from("folders").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    readAll("counterpart_memory", (from, to) =>
      supabase.from("counterpart_memory").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    readAll("email_sender_rules", (from, to) =>
      supabase.from("email_sender_rules").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    readAll("email_skipped_attachments", (from, to) =>
      supabase.from("email_skipped_attachments").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    readAll("invoice_counters", (from, to) =>
      supabase.from("invoice_counters").select("*").eq("user_id", userId).range(from, to)),
    readAll("pay_bundles", (from, to) =>
      supabase.from("pay_bundles").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    readAll("pay_bundle_invoices", (from, to) =>
      supabase.from("pay_bundle_invoices").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
    readAll("feedback", (from, to) =>
      supabase.from("feedback").select("*").eq("user_id", userId).order("id", { ascending: true }).range(from, to)),
  ]);

  // [EXPORT-FILED] btw_filings, read apart from the four above because it answers a different
  // question on failure. The other ledgers are recomputable from what is already in this ZIP; a
  // FILED quarter is not recomputable from anything, because a later invoice moves the live
  // figure and the snapshot is precisely the record of what was sent before it did.
  //
  // Two failures, two answers. The migration not having landed on this deployment (btw_filings.sql
  // is applied by hand) is a complete answer — nobody filed anything here — but it is still not
  // allowed to masquerade as "this owner filed nothing", so it degrades to available:false rather
  // than to an empty list. Any OTHER read error throws, exactly like the ledgers above: an export
  // that quietly ships without a ledger is the harm this whole file is written against.
  //
  // btw_filings is not in the generated types (added by btw_filings.sql) → relaxed client, the
  // same escape hatch api/truth/route.ts uses for this table.
  let btwFilingRows: BtwFilingRow[] = [];
  let btwFilingsAvailable = true;
  try {
    btwFilingRows = await fetchAllRows<BtwFilingRow>((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("btw_filings")
        .select("*")
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!isMissingRelation(message)) {
      throw new Error(`[BOEK-032] btw_filings query failed: ${message}`);
    }
    btwFilingsAvailable = false;
    console.error("[EXPORT-FILED] btw_filings not readable — export ships without it, and says so", { userId, message });
  }

  // [KASSA] till_sales.sql is applied by hand, exactly like btw_filings.sql — so the same two
  // failures get the same two answers. A missing relation is a complete answer (no counter has ever
  // run here), but it still must not masquerade as "this owner rang up nothing": it degrades to
  // available:false and a note, never to an empty list. Any other error throws, like the ledgers.
  // Not in the generated types on a deployment without the migration → relaxed client, same escape
  // hatch btw_filings uses.
  let tillSaleRows: unknown[] = [];
  let tillSalesAvailable = true;
  try {
    tillSaleRows = await fetchAllRows<unknown>((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from("till_sales")
        .select("*")
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!isMissingRelation(message)) {
      throw new Error(`[KASSA] till_sales query failed: ${message}`);
    }
    tillSalesAvailable = false;
    console.error("[KASSA] till_sales not readable — export ships without it, and says so", { userId, message });
  }

  return assembleAccountExportZip({
    userId, profile, invoices, files, skipped,
    bankTransactions: bankRows,
    cashEntries: cashRows,
    cashTrail: cashTrailRows,
    dailyTurnover: turnoverRows,
    tillSales: tillSaleRows,
    tillSalesAvailable,
    messages: msgRows,
    btwFilings: btwFilingRows,
    btwFilingsAvailable,
    registers: {
      invoiceLines: invoiceLineRows,
      clients: clientRows,
      suppliers: supplierRows,
      supplierAliases: supplierAliasRows,
      supplierIbanHistory: supplierIbanHistoryRows,
      articles: articleRows,
      timeEntries: timeEntryRows,
      vehicles: vehicleRows,
      assets: assetRows,
      assetDismissals: assetDismissalRows,
      invoiceReminders: reminderRows,
      bankInvoiceLinks: bankLinkRows,
      folders: folderRows,
      counterpartMemory: memoryRows,
      emailSenderRules: senderRuleRows,
      emailSkipped: skippedMailRows,
      invoiceCounters: counterRows,
      payBundles: bundleRows,
      payBundleInvoices: bundleInvoiceRows,
      feedback: feedbackRows,
    },
  });
}