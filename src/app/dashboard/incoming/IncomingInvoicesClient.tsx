"use client";
// src/app/dashboard/incoming/IncomingInvoicesClient.tsx
// [BOEK-011] Verification queue — incoming invoices from email  ([BRIDGE-B])
// Mobile-first, iOS-style design
//
// Features:
// - Tabs: Te bevestigen | Genegeerd
// - Tap a card → expands (accordion) with full details + PDF view
// - "Verifiëren" → review/edit AI amounts (TRAIL 2/3) →
//     "Bevestig / verifieer" (becomes a shared Crediteur, unpaid)  OR
//     "Markeer als betaald" → Bank/Contant (marks paid)
// - "Negeer" → confirmation → archive (recoverable)
// - Restore ignored invoices → back to the verification queue

import { useState, useEffect, useCallback, useRef } from "react";
import { effectiveTaxKind, type TaxKind } from "@/lib/tax-letter";

// [AANSLAG] One literal key per kind — a template key would be invisible to the [TAAL] gate.
const TAX_KIND_LABEL: Record<TaxKind, string> = {
  inkomstenbelasting: "ink.aanslag.inkomstenbelasting",
  zorgverzekeringswet: "ink.aanslag.zorgverzekeringswet",
  omzetbelasting: "ink.aanslag.omzetbelasting",
  motorrijtuigenbelasting: "ink.aanslag.motorrijtuigenbelasting",
  overig: "ink.aanslag.overig",
};
function taxKindLabel(inv: { tax_kind?: string | null; client_name?: string | null }): string | null {
  const k = effectiveTaxKind(inv);
  return k ? TAX_KIND_LABEL[k] : null;
}
// [VERVANG-OVERAL] Eén regel voor "is er een gemarkeerde tweeling?" — gedeeld met de betaalpagina.
import { supersedeTargetOf } from "@/lib/supersede-target";
// [WAAROM-WACHT] De zin die zegt waarom DIT document nog op de eigenaar wacht. De component
// draagt zelf geen taal — zie why-waiting.ts.
import { waitingReasonOf, explainWaiting } from "@/lib/why-waiting";
// [SERVER-ZIN] Never a machine code in front of the owner — see server-message.ts.
import { failureText } from '@/lib/server-message'
// [MELDING-WEG] The X on a result row, and the duplicate's place in the owner's language.
import { DismissX } from "@/components/ui/DismissX";
import { duplicateWhere } from "@/lib/duplicate-sentence";
// [TZ] The owner's Amsterdam day, never the UTC one — see format-nl.ts.
import { formatEuroNL, amsterdamToday } from '@/lib/format-nl'
import Link from "next/link";
// [BOEK-011] Centralized navigation — single source of truth across the app
import { FONT } from "@/lib/design/tokens";
import { triggerBankAutoConfirm } from "@/lib/bank-auto-confirm-trigger";
import { combineImagesToPdf } from "@/lib/combine-images-pdf";
import { rowMatchesQuery } from "@/lib/search";
// [NEGEER-REDEN] Eén lijst redenen, gedeeld met de API en met de CHECK-constraint.
import { ARCHIVE_REASONS, ARCHIVE_REASON_LABELS, archiveReasonLabel, type ArchiveReason } from "@/lib/archive-reason";
// [AFZENDERREGEL] Alleen bij "geen factuur" mag een blijvende regel voorgesteld worden.
import { mayOfferSenderRule } from "@/lib/sender-rules";
// [BULK-IGNORE] Honest counting after a batch: permanently refused ≠ temporarily failed.
import {
  classifyIgnoreFailure, bulkIgnoreSummary, bulkIgnoreOffersUndo, bulkRestoreSummary,
  type BulkIgnoreTally,
} from "@/lib/bulk-ignore";
// [INTAKE-IMG-NORMALIZE] A lone HEIC/HEIF/WebP/BMP/TIFF (an iPhone photo) reaches the reader as an
// "unsupported type" and is filed unreadable — losing the invoice. Normalize to a bounded JPEG
// before upload; a PDF (incl. the multi-page combine's output) passes through untouched.
// [UPLOAD-PLAFOND] One shared fit-and-send — see upload-fit.ts.
import { sendWithFit } from "@/lib/upload-fit";
// [UPLOAD-ERRORS] One HTTP-status → owner-sentence translator, shared with /dashboard/upload and
// the Toevoegen sheet. Pure and tested; this surface posts to the same /api/intake.
import { describeUploadFailure } from "@/lib/upload-failure";
// [AMOUNT-TRIPLET] ex + btw = total keeps holding, whichever of the three you type.
import { setExcl, setBtw, setIncl, splitByRate, rateOfTriplet, amountFieldText, AMOUNT_PLACEHOLDER, NL_BTW_RATES } from "@/lib/amount-triplet";
// [KOMMA-INVOER] One tolerant reader for an amount a Dutch owner TYPES — see parse-nl.ts.
import { parseAmountNL } from "@/lib/parse-nl";
// [STATIEGELD-GAT] Het statiegeld dat de lezer liet vallen — zie statiegeld.ts.
import { type DepositGap } from "@/lib/statiegeld";
// [CENT] Cent rounding comes from invoice-totals.round2 — one definition for the whole app.
import { round2 } from "@/lib/invoice-totals";
// [DOC-INLINE] The paper, our reading and the checks on one screen — see the component header.
import InvoiceDocumentSheet from "@/components/invoice/InvoiceDocumentSheet";
// [LEVERANCIER-KIEZEN] The supplier name field, with the owner's own suppliers under it —
// so a correction lands ON an existing company instead of founding a second one.
import SupplierNameInput, { type SupplierChoice } from "@/components/invoice/SupplierNameInput";
// [LEVERANCIER-STAAT-IN-HET-LOGO] The confidence line, from the leaf both the reader and this
// screen read — never a fourth copy of 0.7. See confidence.ts.
import { LOW_CONFIDENCE } from "@/lib/confidence";
// [REREAD-CONFIRMED] Who may be read again — the same rule the server re-checks.
import { reimportDecision, reimportPromptKey } from "@/lib/reimport-eligibility";
// [DATE-NL] A date the owner TYPES, in the order they read it. The native control puts the
// MONTH first under an en-US browser and nothing on the page changes that — see date-field-nl.ts.
import { DUTCH_DATE_PLACEHOLDER, formatDutchDateInput, dutchDateToIso, isoToDutchDate } from "@/lib/date-field-nl";

// ── Types ─────────────────────────────────────────────────────────────────────

// [IMPORT-MONITOR] Read-time health verdict computed server-side (page.tsx via
// @/lib/import-health). Mirrored here so the client stays self-contained — the
// shape MUST match ImportHealth in @/lib/import-health.
interface ImportHealth {
  level: "clean" | "needs-review";
  // Plain-language Dutch reasons, owner-facing. Empty when level === 'clean'.
  reasons: string[];
  // [ANDER-TOTAAL] A totals block that IS on the document, when the one we read is not. Offered
  // below as one tap, never applied — see the button beside the arithmetic warning.
  alternativeTotals?: { ex: number; btw: number; inc: number };
  flags: {
    arithmetic: boolean;
    vendor: boolean;
    invoiceNumber: boolean;
    invoiceDate: boolean;
    reminder: boolean;
    // [DEDUP-SOFT] stond al in ImportHealth maar ontbrak in deze spiegel.
    possibleDuplicate: boolean;
    // [IBAN-WISSEL] Bekende leverancier, ander rekeningnummer. Krijgt bewust een EIGEN,
    // zwaardere badge: dit is geen leesfout maar een geldwaarschuwing, en de handeling
    // erachter (bellen op een zelf opgezocht nummer) is een andere dan "controleer de cijfers".
    ibanChanged: boolean;
    // [MULTI-INVOICE] Eén bestand dat meerdere facturen lijkt te bevatten — of waarvan we dat
    // niet KONDEN nagaan (een gescande stapel zonder tekstlaag). Import-health zet beide op deze
    // ene vlag, want de eigenaar beantwoordt in beide gevallen dezelfde vraag. Stond in
    // ImportHealth en ontbrak in deze spiegel, terwijl de kop hierboven zegt dat hij moet kloppen.
    multipleInvoices: boolean;
  };
}

// [OBSERVABILITY] Map a stored skip reason to a short, owner-facing line. Known codes get a
// friendly phrase; a Dutch reason the AI already wrote (e.g. "rekeningoverzicht — …") is shown
// as-is (trimmed). Never a raw technical token the owner can't understand.
import { useRouter } from "next/navigation";
import { useDialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { M3, COLUMN, PAGE_HEADER_HEIGHT } from '@/lib/design/tokens'
import { applyServerRefresh } from '@/lib/queue-sync'
// [FOCUS-KOP] Where a deep-linked row must come to rest — see the header of that file.
import { landRowUnderChrome } from '@/lib/focus-scroll'
// [ONE-TAP-REPAIR] The gate that names the two possible readings of a broken breakdown.
import { reconcileBtw } from '@/lib/btw-reconcile'
import { proposeSplit } from '@/lib/vendor-vat-rate'
import { doubtAboutInputVat } from '@/lib/btw-soort'
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'
// [DATE-NL] The typing surface, in Dutch order — see date-field-nl.ts.
import DateFieldNL from '@/components/ui/DateFieldNL'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
// [GELEERD-SINDSDIEN] De genegeerde facturen die de lezer inmiddels wél kan lezen.
import GeleerdPanel from '@/components/grootboek/GeleerdPanel'
// [PAGINA-VOLGORDE] The order of the pages of one paper invoice, decided in one place and shown
// in one tray — the same on Uploaden. See src/lib/page-order.ts for why a plain sort is wrong.
import { usePageTray } from '@/lib/use-page-tray'
import PageTray from '@/components/intake/PageTray'
// [TEKST-SELECTIE] Een sleep die tekst selecteert is geen tik op de rij: de kaart klapte
// open en dicht terwijl de eigenaar een factuurnummer probeerde te kopiëren.
import { onRowTap } from '@/lib/row-tap'

function friendlySkipReason(reason: string, t: ReturnType<typeof translator>): string {
  const r = (reason || "").toLowerCase();
  if (r === "could_not_read") return t('ink.reden.onleesbaar');
  if (r === "not_invoice") return t('ink.reden.geenFactuur');
  if (r.startsWith("portal_link") || r.includes("geen bijlage")) return t('ink.reden.geenBijlage');
  // An AI-written Dutch reason is stored TEXT, not a catalogue entry — shown as it is, capped.
  return reason.length > 80 ? `${reason.slice(0, 77)}…` : reason;
}

interface IncomingInvoice {
  id: string;
  client_name: string;
  client_email: string | null;
  // [BRIDGE-CREDITNOTA-SIGN] 'creditnota' → amounts are NEGATIVE by design
  // (matching the paper + outgoing creditnota [BOEK-031]); drives the badge
  // and the signed amount display. Optional: the page select must include it
  // (patch note) — absent means 'factuur' (default).
  invoice_type?: string | null;
  // [AANSLAG] Which tax a Belastingdienst letter concerns; null on an ordinary invoice.
  tax_kind?: string | null;
  total_ex_btw: number;
  btw_amount: number;
  total_inc_btw: number;
  // [PARTIAL-PAY] running total settled by instalments (0 when unpaid). A value 0 < amount_paid <
  // |total| means the invoice is a deelbetaling: still openstaand, but part is already received.
  amount_paid?: number | null;
  invoice_date: string;
  invoice_number: string;
  source: string;
  pdf_url: string | null;
  document_id: string | null;
  created_at: string;
  // [BOEK-011] folder where the file was stored in Mijn Bestanden
  folder_id: string | null;
  folder_name: string | null;
  // [BRIDGE-EXTRACT] per-field AI confidence (0–1) — flags weak fields in the modal
  field_confidence: {
    vendor?: number;
    invoice_number?: number;
    invoice_date?: number;
    // [SMART-INTAKE] intake suggestion: a kassabon routed here is likely paid.
    // A SUGGESTION only — the human confirms via "Markeer als betaald".
    _intake_kind?: string;     // 'receipt' when it came from the camera as a bon
    _intake_suggest?: string;  // 'paid' → surface "Markeer als betaald" prominently
    // [BON-BETAALWIJZE] What the PAPER printed about the settlement. Written by both intake doors
    // and, until now, read by nothing at all — bon-betaalwijze.ts said so in its own header: "een
    // jsonb die geen enkele voorwaarde in de app leest". So the app read "Bankpas 70,29" off the
    // till slip, parsed it, stored it, and then asked the owner Bank or Contant anyway.
    _intake_paid_method?: string;        // 'bank' | 'kas', normalised
    _intake_paid_method_zeker?: boolean; // true ONLY when the paper itself named it
    _intake_paid_evidence?: string;      // the printed words the reading rests on
    _intake_paid_card4?: string;         // last 4 of the card, when printed
    _intake_paid_date?: string;          // the settlement date the paper printed
  } | null;
  // [CHECKLIST] The supplier's account number as printed. Selected so the "rekeningnummer
  // ongewijzigd" row can be ANSWERED — without it the checklist would say "er staat geen
  // rekeningnummer op deze factuur" about every queued invoice, which is not a missing number on
  // the paper, it is a column we did not ask for. Stating that as a finding would be the exact
  // overstatement invoice-checks.ts exists to prevent.
  vendor_iban?: string | null;
  // [IMPORT-MONITOR] import-health verdict — drives the calm/attention surface
  health: ImportHealth;
  // [INCOMING-BEVESTIGD] 'received' (verified, te betalen) or 'paid' (settled) on the Bevestigd
  // tab; absent on pending ('processing') / ignored ('archived').
  status?: string | null;
  // [NEGEER-REDEN] Waarom deze factuur genegeerd is. Alleen gevuld op de Genegeerd-lijst, en ook
  // daar mag hij ontbreken: oude rijen weten het niet meer, en de vraag is vrijwillig.
  archive_reason?: string | null;
  // [SUPERSEDE] Which invoice replaced this one. Only on the Genegeerd list, optional even there.
  superseded_by_number?: string | null;
}

interface ConnectionStatus {
  connected: boolean;
  provider: "gmail" | "outlook" | null;
  email: string | null;
  connected_at: string | null;
  needs_reauth: boolean;
  pending_count: number;
}

interface Props {
  initialInvoices: IncomingInvoice[];
  ignoredInvoices: IncomingInvoice[];
  confirmedInvoices: IncomingInvoice[];
  connectionStatus: ConnectionStatus;
  // [BOEK-011] Used by the Logo Universal Click pattern (Navigation Strategy v1.0)
  userRole: "zzper" | "accountant";
  // [READING-MEMORY] Per supplier (trimmed + lowercased name), one sentence about what the owner
  // has repeatedly had to correct on that supplier's invoices. Only for suppliers actually in this
  // queue, and only past the threshold — most queues carry none at all. Optional: an older server
  // render, or a failed audit read, simply sends nothing and the cards look as they always did.
  readingHints?: Record<string, string>;
  // [TARIEF-GEHEUGEN] Het tarief dat een leverancier aantoonbaar altijd rekent, met het aantal
  // facturen waarop dat rust. Alleen aanwezig voor leveranciers waarvan ELKE goed gelezen factuur
  // hetzelfde wettelijke tarief draagt — zie vendor-vat-rate.ts.
  vendorRates?: Record<string, { rate: number; basedOn: number; source?: 'history' | 'supplier' }>;
  // [NO-SILENT-EMPTY] Which of the server's reads did not come back, in the server's own Dutch
  // source names. Empty (or absent, from an older render) means every list below is the whole
  // list. Non-empty qualifies EVERYTHING on this screen — the counts, the tabs, and above all the
  // absence of rows, which on this page renders as "Alles verwerkt".
  readFailed?: string[];
  // [LEVERANCIER-KIEZEN] The suppliers this owner already has, for the name field in the verify
  // modal. Optional: without them the field is the plain text box it has always been.
  suppliers?: SupplierChoice[];
  // [NO-SILENT-EMPTY] True when that read FAILED — which is a different sentence from an empty
  // list, and the field says so. An empty list means "you have no suppliers yet"; this means "we
  // could not look", and only one of those two may imply that confirming creates a new supplier.
  suppliersUnavailable?: boolean;
}

type Tab = "pending" | "ignored" | "confirmed";

// ── Formatters ────────────────────────────────────────────────────────────────

const NL_CURRENCY = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
});

// [TZ] timeZone PINNED. formatDate below feeds this a DATE-ONLY string, and `new Date("2026-01-01")`
// is midnight UTC — formatted in the BROWSER's zone, every date west of UTC rendered a day early.
// This formatter prints the YEAR, so on a new-year boundary that is "31 december 2025" on an
// invoice dated 2026: the wrong TAX YEAR, on the screen where the tax period is being confirmed.
// format-nl.ts opens with this exact warning ("We never let that happen on a legal document").
// The Dutch long-date SHAPE is unchanged — only the day it names is now the owner's.
const NL_DATE = new Intl.DateTimeFormat("nl-NL", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Europe/Amsterdam",
});

function formatDate(dateStr: string): string {
  try {
    return NL_DATE.format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function formatAmount(amount: number): string {
  return NL_CURRENCY.format(amount);
}

/**
 * [SERVER-REASON] What the owner reads when /api/email/confirm/[id] refuses.
 *
 * That route writes real, owner-facing Dutch for the cases it decides itself — "Factuurdatum
 * ontbreekt — voer eerst de factuurdatum in", the 409 "Deze factuur is al bevestigd — ververs de
 * pagina", the DELETE's "draai eerst de betaling terug". Those are the whole point of showing the
 * server's message instead of a fixed sentence: they name the way out.
 *
 * Its 5xx are a different animal — `{ error: error.message }` is whatever supabase-js said, in
 * English, about a schema cache or a statement timeout. And a 502/504 comes from the platform as
 * HTML, so there is no JSON at all. Neither belongs on a shop owner's phone, so above 4xx we keep
 * our own sentence. `field` is which key carries the sentence on that verb (POST/PATCH use `error`,
 * DELETE uses `error` for the code and `detail` for the sentence).
 */
async function confirmFailureMessage(
  res: Response,
  fallback: string,
  field: "error" | "detail" = "error",
): Promise<string> {
  if (res.status >= 500) return fallback;
  const data = await res.json().catch(() => ({} as Record<string, unknown>));
  const sentence = data?.[field];
  return typeof sentence === "string" && sentence.trim() ? sentence.trim() : fallback;
}

// [BRIDGE-CREDITNOTA-SIGN] Amount display that keeps the SIGN. The old
// `x > 0 ? format : "—"` guard rendered every creditnota amount (negative by
// design, matching [BOEK-031] outgoing) as "—" — the bug in the screenshot.
// Now: 0/absent/non-finite → "—" (unchanged for empty invoices); any other
// finite value (positive OR negative) → formatted with its sign.
// NL_CURRENCY renders negatives natively (e.g. "€ -4,84").
function formatSignedAmount(amount: number): string {
  return Number.isFinite(amount) && amount !== 0 ? NL_CURRENCY.format(amount) : "—";
}

// ── Email connect card ────────────────────────────────────────────────────────

function ConnectEmailCard({ status }: { status: ConnectionStatus }) {
  const t = translator(useLocale())
  const dialog = useDialog();
  // [INSTANT] router.refresh() re-runs this route's server component and
  // streams fresh props in; window.location.reload() threw away the whole
  // document — bundle, scroll position, which tab was open, which card was
  // expanded — and rebuilt it from nothing. Same data, a fraction of the wait.
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  // [BACKFILL] Re-scan control — an owner-triggered re-pull over a chosen start date, for
  // invoices the incremental sync already passed (e.g. one missed before a fix landed).
  const [backfillOpen, setBackfillOpen] = useState(false);
  const [backfillDate, setBackfillDate] = useState<string>(
    () => `${new Date().getFullYear()}-01-01`
  );
  // [INCOMING-CHROME] Everything that manages the MAILBOX rather than the queue —
  // re-scan an older period, see what import skipped, disconnect — lives behind
  // this one toggle. See the comment on the row itself for why.
  const [manageOpen, setManageOpen] = useState(false);
  // [OBSERVABILITY] "Overgeslagen bij import" — transparency into what the pipeline did NOT
  // turn into an invoice, so nothing is silently lost. Loaded on demand when opened.
  const [skippedOpen, setSkippedOpen] = useState(false);
  const [skippedLoading, setSkippedLoading] = useState(false);
  const [skippedItems, setSkippedItems] = useState<
    { filename: string; reason: string; createdAt: string }[] | null
  >(null);
  const [couldNotReadCount, setCouldNotReadCount] = useState(0);
  // [GEEN-STILLE-KAP] How many rows exist, not how many we drew. Both lists are capped and ordered
  // newest-first, so what falls off is always the OLDEST — the attachments nearest a deadline and
  // likeliest to be the one being hunted. A cap this panel does not admit to is the same lie as an
  // empty list it does not admit to.
  const [skippedTotal, setSkippedTotal] = useState(0);
  // [SKIPPED-READ-HONEST] Held apart from the list. A failed lookup leaves skippedItems null so a
  // reopen retries, and this sentence is what the panel shows instead of an all-clear it cannot back.
  const [skippedError, setSkippedError] = useState<string | null>(null);
  // [TWEEDE-KANS] The unread files themselves, so the panel can offer a second reading instead of
  // only counting them.
  const [unreadDocs, setUnreadDocs] = useState<Array<{ id: string; fileName: string }>>([]);
  // [HERINNERING-NOOIT] Reminders whose invoice is not in the books — the owner may book from them.
  const [reminderDocs, setReminderDocs] = useState<Array<{ id: string; fileName: string }>>([]);
  const [rereadingId, setRereadingId] = useState<string | null>(null);
  const [rereadMessage, setRereadMessage] = useState<string | null>(null);

  /**
   * [TWEEDE-KANS] Ask the app to read a stored file again with the reader it has now.
   *
   * Nothing is booked by this: a recognised invoice lands in the verify queue, where the owner
   * confirms it like any other. The answer is always a sentence — a silent button on a panel whose
   * whole purpose is honesty about what went missing would be the wrong thing twice over.
   */
  const rereadDocument = async (docId: string) => {
    setRereadingId(docId);
    setRereadMessage(null);
    try {
      const res = await fetch(`/api/documents/${docId}/read-as-invoice`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRereadMessage(failureText(res.status, json, t('ink.reread.fout')));
        return;
      }
      setRereadMessage(typeof json?.message === "string" ? json.message : t('ink.reread.klaar'));
      // Booked → it left the unread list; drop it here too rather than making the owner reload.
      if (json?.booked) {
        setUnreadDocs((prev) => prev.filter((d) => d.id !== docId));
        setReminderDocs((prev) => prev.filter((d) => d.id !== docId));
      }
    } catch {
      setRereadMessage(t('ink.reread.foutVerbinding'));
    } finally {
      setRereadingId(null);
    }
  };

  // [BOEK-011] One tap = full import. The server caps each call at 25 new
  // invoices (function time limit); it reports `remaining` and we simply call
  // again until the backlog is drained — with live progress so the user sees
  // "Bezig… 25 van 61" instead of a silent partial import. MAX_ROUNDS guards
  // against a server bug ever looping us forever.
  // [BACKFILL] When `backfillSince` (an ISO date) is passed, the SAME batch loop runs against
  // /api/email/backfill (re-scan from that date, watermark held) instead of the incremental
  // /api/email/sync. Everything else — the continue-until-drained loop, the honest summary — is
  // identical, so a re-scan reuses the exact proven machinery.
  const handleSync = async (backfillSince?: string) => {
    setSyncing(true);
    setSyncResult(null);

    const MAX_ROUNDS = 12; // 12 × 25 = 300 invoices per tap — plenty
    let totalSaved = 0;
    let round = 0;
    // [BOEK-TRUST] Accumulate the balance buckets across all rounds so the final
    // message can reassure honestly: everything fetched this session landed in a
    // known bucket (imported / skipped / duplicate), or is being retried.
    let totalSkipped = 0;
    let totalDuplicate = 0;
    let totalErrors = 0;
    let totalCouldNotRead = 0;
    let totalKeptForBooking = 0;
    let anyUnbalanced = false;
    // [BOEK-011] No-progress guard: if a round saves nothing AND remaining
    // didn't shrink, looping again would just repeat the same work. Stop and
    // tell the user honestly instead of spinning.
    let lastRemaining = Number.POSITIVE_INFINITY;

    try {
      while (round < MAX_ROUNDS) {
        round++;
        const res = backfillSince
          ? await fetch("/api/email/backfill", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sinceDate: backfillSince }),
            })
          : await fetch("/api/email/sync", { method: "POST" });
        const data = await res.json();

        if (data.error) {
          setSyncResult(`${t('ink.sync.foutPrefix')} ${failureText(res.status, data, t('ink.sync.mislukt'))}`);
          setSyncing(false);
          return;
        }

        totalSaved += data.saved ?? 0;
        // [BOEK-TRUST] Roll up the reconciliation buckets.
        if (data.balance) {
          totalSkipped += data.balance.skipped ?? 0;
          totalDuplicate += data.balance.duplicate ?? 0;
          if (data.balance.balanced === false) anyUnbalanced = true;
        }
        totalCouldNotRead += data.couldNotRead ?? 0;
        totalKeptForBooking += data.keptForBooking ?? 0;
        totalErrors += data.errors ?? 0;
        const remaining = data.remaining ?? 0;

        if (remaining > 0) {
          // [BOEK-011] Progress = invoices saved OR non-invoices registered.
          // A batch that's all logos saves 0 but still shrinks the backlog
          // (those attachments are now in the skip registry). Only flag "no
          // progress" when NOTHING advanced AND remaining didn't fall.
          const advanced = (data.saved ?? 0) > 0 || (data.skipped ?? 0) > 0;
          const noProgress = !advanced && remaining >= lastRemaining;
          if (noProgress) {
            setSyncResult(
              totalSaved > 0
                ? t('ink.sync.deelOpgeslagen', { n: totalSaved })
                : t('ink.sync.nietsVerwerkt')
            );
            setSyncing(false);
            return;
          }
          lastRemaining = remaining;
          // Live progress — the denominator grows as we learn about the backlog
          setSyncResult(
            t('ink.sync.bezig', { n: totalSaved, rest: remaining })
          );
          continue; // next batch immediately
        }

        // [BOEK-TRUST] Done — honest, reassuring summary built from the balance.
        // The reassurance the owner opens the app for: everything that arrived
        // is accounted for. We keep it to one calm line; details stay implicit.
        //   · normal case → "X geïmporteerd. Alles is verwerkt."
        //   · some retried → name it plainly, it's not a loss (next sync retries)
        //   · rare gap    → "even controleren" without alarm
        let message: string;
        if (anyUnbalanced) {
          message = t('ink.sync.controleren', { n: totalSaved });
        } else if (totalErrors > 0) {
          message = t('ink.sync.opnieuwGeprobeerd', { n: totalSaved, fouten: totalErrors });
        } else {
          const extra = totalSkipped + totalDuplicate;
          message =
            extra > 0
              ? t('ink.sync.verwerktExtra', { n: totalSaved, extra })
              : t('ink.sync.verwerkt', { n: totalSaved });
        }
        // [COULD-NOT-READ] Never hide files we couldn't read: tell the owner to check
        // them in bestanden (they were kept, not discarded, and not booked as anything).
        if (totalCouldNotRead > 0) {
          message += ' ' + (
            totalCouldNotRead === 1
              ? t('ink.sync.nietLezenEen')
              : t('ink.sync.nietLezenMeer', { n: totalCouldNotRead })
          );
        }
        // [ARCHIEF-OPEN] A kept kassa/grootboek file is READ and waiting for one press of a
        // button — a different sentence from "we couldn't read it", and it must be said HERE, in
        // this run's summary, rather than as a standing counter somewhere. Nothing links a booked
        // daily_turnover day back to the document it came from, so a standing "N klaar om te
        // boeken" badge could never fall back to zero, and a counter that never reaches zero is
        // noise the owner learns to skip past.
        if (totalKeptForBooking > 0) {
          message += ' ' + (
            totalKeptForBooking === 1
              ? t('ink.sync.kassaKlaarEen')
              : t('ink.sync.kassaKlaarMeer', { n: totalKeptForBooking })
          );
        }
        setSyncResult(message);
        setTimeout(() => router.refresh(), 1500);
        return;
      }

      // MAX_ROUNDS hit — extremely large mailbox; be honest, let them tap again
      setSyncResult(
        t('ink.sync.meerKlaar', { n: totalSaved })
      );
    } catch {
      setSyncResult(
        totalSaved > 0
          ? t('ink.sync.onderbroken', { n: totalSaved })
          : t('ink.sync.mislukt')
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    const ok = await dialog.confirm({
      title: t('ink.email.verwijderenVraag'),
      message: t('ink.email.verwijderenUitleg'),
      confirmLabel: t('ink.email.verwijderenBevestig'),
      danger: true,
    });
    if (!ok) return;
    await fetch("/api/email/sync", { method: "DELETE" });
    router.refresh();
  };

  // [OBSERVABILITY] Load the "overgeslagen bij import" list the first time it's opened.
  const openSkipped = async () => {
    setSkippedOpen(true);
    if (skippedItems !== null || skippedLoading) return;
    setSkippedLoading(true);
    try {
      const res = await fetch("/api/email/skipped");
      const data = await res.json();
      if (res.ok) {
        setSkippedError(null);
        setSkippedItems(data.skipped ?? []);
        setSkippedTotal(typeof data.skippedTotal === "number" ? data.skippedTotal : (data.skipped ?? []).length);
        setCouldNotReadCount(data.couldNotReadCount ?? 0);
        setUnreadDocs(Array.isArray(data.unread) ? data.unread : []);
        setReminderDocs(Array.isArray(data.reminders) ? data.reminders : []);
      } else {
        // [SKIPPED-READ-HONEST] A failed read is NOT an empty list. Both branches used to answer
        // setSkippedItems([]), and an empty list renders "Niets overgeslagen — alles wat binnenkwam
        // is verwerkt." The route goes to some length NOT to say that: it returns 503 with a
        // sentence saying the lookup failed and that this tells you nothing about what was skipped.
        // The screen threw that away and printed the false all-clear anyway — the server refusing
        // to lie is worth nothing if the client lies on its behalf.
        setSkippedError(failureText(res.status, data, t('ink.skipped.fout')));
      }
    } catch {
      setSkippedError(
        t('ink.skipped.fout'),
      );
    } finally {
      setSkippedLoading(false);
    }
  };

  // ── [CIRKEL] The overgeslagen/onleesbaar pile, extracted so BOTH states render it ──
  //
  // /api/email/skipped is source-agnostic (every document with a skipped ai_doc_type and no
  // invoice), so an UPLOADED file that could not be read lands in it too — but the only UI for
  // it lived inside the mailbox-connected branch. An upload-only owner therefore had no route to
  // this list, and none to rereadDocument, the one action that turns such a file back into an
  // invoice. That was the largest silent-loss surface in the intake flow: not lost data, lost
  // VISIBILITY of data the app holds.
  const overgeslagenBlok = (
    <>
        {/* [OBSERVABILITY] What did import NOT turn into an invoice, and why. Read-only
            transparency so a misjudged or unreadable document is never invisibly lost. */}
        <div style={{ marginTop: 12 }}>
          {!skippedOpen ? (
            <button
              onClick={openSkipped}
              style={{
                background: "transparent", border: "none", color: "#5f6368",
                fontSize: 12.5, cursor: "pointer", padding: 0,
              }}
            >
              {t('ink.overgeslagenBekijk')}
            </button>
          ) : (
            <div style={{ background: "#f8f9fa", borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#202124" }}>{t('ink.overgeslagen')}</span>
                <button
                  onClick={() => setSkippedOpen(false)}
                  style={{ background: "transparent", border: "none", color: "#5f6368", fontSize: 13, cursor: "pointer" }}
                >
                  {t('ink.sluit')}
                </button>
              </div>
              {skippedLoading ? (
                <div style={{ fontSize: 13, color: "#5f6368" }}>{t('oneind.laden')}</div>
              ) : skippedError ? (
                /* [SKIPPED-READ-HONEST] The failure, in words, INSTEAD of the list. Not beside it:
                   an all-clear next to an error is still an all-clear, and "Niets overgeslagen" is
                   the sentence that makes an owner stop looking for the invoice they came for. */
                <div style={{ fontSize: 12.5, color: "#7A4B00", background: "#FFF3E0", borderRadius: 8, padding: "8px 10px", lineHeight: 1.5 }}>
                  {skippedError}
                </div>
              ) : (
                <>
                  {couldNotReadCount > 0 && (
                    <div style={{ fontSize: 12.5, color: "#7A4B00", background: "#FFF3E0", borderRadius: 8, padding: "8px 10px", marginBottom: 8, lineHeight: 1.5 }}>
                      {couldNotReadCount === 1 ? t('ink.sync.nietLezenEen') : t('ink.sync.nietLezenMeer', { n: couldNotReadCount })}
                    </div>
                  )}
                  {/* [TWEEDE-KANS] The sentence above said "ze staan in je bestanden" and there was
                      nothing to do there: the sync filters a given-up attachment out of every future
                      run, and re-uploading the same bytes is refused as a duplicate. So the file was
                      visible, unusable, and its voorbelasting unclaimed. Now the reader we have TODAY
                      can be pointed at the file we already have. */}
                  {(unreadDocs?.length ?? 0) > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 12, color: "#5f6368", marginBottom: 6, lineHeight: 1.5 }}>
                        {t('ink.reread.uitleg')}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {(unreadDocs ?? []).map((d) => (
                          <div key={d.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
                            <span style={{ color: "#202124", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                              {d.fileName}
                            </span>
                            <button
                              onClick={() => void rereadDocument(d.id)}
                              disabled={rereadingId === d.id}
                              style={{ flexShrink: 0, fontSize: 12, fontWeight: 500, border: "1px solid #dadce0", background: "#fff", color: "#0B57D0", borderRadius: 999, padding: "5px 12px", cursor: rereadingId === d.id ? "default" : "pointer", minHeight: 32 }}
                            >
                              {rereadingId === d.id ? t('act.bezig') : t('ink.reread.knop')}
                            </button>
                          </div>
                        ))}
                      </div>
                      {/* [GEEN-STILLE-KAP] The cap, said out loud. The list stops at 50 and sorts
                          newest-first, so the ones it drops are the OLDEST — nearest a deadline,
                          likeliest to be the one being looked for. */}
                      {couldNotReadCount > unreadDocs.length && (
                        <div style={{ fontSize: 11.5, color: "#a0a0a5", marginTop: 6, lineHeight: 1.5 }}>
                          {t('ink.reread.kap', { n: unreadDocs.length, totaal: couldNotReadCount })}
                        </div>
                      )}
                      {rereadMessage && (
                        <div style={{ fontSize: 12.5, color: "#202124", background: "#E8F0FE", borderRadius: 8, padding: "8px 10px", marginTop: 8, lineHeight: 1.5 }}>
                          {rereadMessage}
                        </div>
                      )}
                    </div>
                  )}
                  {/* [HERINNERING-NOOIT] A reminder the app filed because its invoice is not in the
                      books. Same button, same door (read-as-invoice), one deliberate tap. */}
                  {reminderDocs.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 12, color: "#5f6368", marginBottom: 6, lineHeight: 1.5 }}>
                        {t('ink.herinnering.uitleg')}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {reminderDocs.map((d) => (
                          <div key={d.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
                            <span style={{ color: "#202124", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                              {d.fileName}
                            </span>
                            <button
                              onClick={() => void rereadDocument(d.id)}
                              disabled={rereadingId === d.id}
                              style={{ flexShrink: 0, fontSize: 12, fontWeight: 500, border: "1px solid #dadce0", background: "#fff", color: "#0B57D0", borderRadius: 999, padding: "5px 12px", cursor: rereadingId === d.id ? "default" : "pointer", minHeight: 32 }}
                            >
                              {rereadingId === d.id ? t('act.bezig') : t('ink.herinnering.knop')}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {(skippedItems?.length ?? 0) === 0 && couldNotReadCount === 0 && reminderDocs.length === 0 ? (
                    <div style={{ fontSize: 12.5, color: "#5f6368" }}>
                      {t('ink.nietsOvergeslagen')}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {/* [BIJLAGE-TERUGWEG] The date, not only the name. The one thing an owner can
                          actually do with a misjudged attachment is open the e-mail it came in and
                          add it by hand — and "sepa-01.pdf" alone does not find that e-mail. The
                          API has returned createdAt all along; the row dropped it. */}
                      {(skippedItems ?? []).map((s, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
                          <span style={{ color: "#202124", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                            {s.filename}
                            {s.createdAt && (
                              <span style={{ color: "#a0a0a5" }}> · {formatDate(s.createdAt)}</span>
                            )}
                          </span>
                          <span style={{ color: "#5f6368", flexShrink: 0, maxWidth: "55%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {friendlySkipReason(s.reason, t)}
                          </span>
                        </div>
                      ))}
                      {/* [GEEN-STILLE-KAP] Same for this list: 100 rows, newest first, and until now
                          nothing said there were more. An owner scrolling to the bottom of a
                          truncated list concludes their invoice is not there. */}
                      {skippedTotal > (skippedItems?.length ?? 0) && (
                        <div style={{ fontSize: 11.5, color: "#a0a0a5", marginTop: 2, lineHeight: 1.5 }}>
                          {t('ink.skipped.kap', { n: skippedItems?.length ?? 0, totaal: skippedTotal })}
                        </div>
                      )}
                    </div>
                  )}
                  {/* [BIJLAGE-TERUGWEG] Two situations, two answers — this said one thing and it was
                      false for the case an owner is most likely in.

                      "Oudere e-mails opnieuw ophalen" cannot bring back an attachment that is IN
                      this list. PHASE 0 of the sync loads email_skipped_attachments into knownKeys
                      and filters those attachments out of EVERY run, backfill included — measured,
                      and stated in the [TWEEDE-KANS] gate. So an owner reading "leek geen factuur"
                      next to a real invoice followed this advice, got "0 nieuw", and concluded the
                      invoice was never there. A wrong answer the app then confirmed.

                      The bytes of a not-an-invoice attachment are deliberately discarded (a mailbox
                      full of signature images is not worth storing), so the honest route back is the
                      mailbox itself — which is why the rows above now carry their date. */}
                  <div style={{ fontSize: 11.5, color: "#a0a0a5", marginTop: 8, lineHeight: 1.5 }}>
                    {t('ink.email.echteFactuur')}
                    <br />
                    {/* [TAAL] One key per sentence — the old <em>niet</em> split cannot survive a
                        word order that changes per language. */}
                    {t('ink.email.misFactuur')} {t('ink.email.nietTussen')}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
    </>
  )

  if (status.connected) {
    const providerName = status.provider === "gmail" ? "Gmail" : "Outlook";
    // [EMAIL-HEALTH] The grant can be dead while the row still exists — never render the calm green
    // "verbonden" state in that case, or the automatic import rots silently behind a false ✓.
    const needsReauth = status.needs_reauth;

    // [INCOMING-CHROME] The mailbox is the page's PLUMBING, not its work. It used
    // to occupy a 200px block at the top — a 28px emoji, the provider, the
    // address, a full-width blue Synchroniseer, a red-bordered Ontkoppel beside
    // it, and two bare text links — so the queue the owner actually came for
    // started below the fold and the first invoice was the seventh thing on
    // screen. Worse, the one irreversible control on the page (disconnect the
    // mailbox, touched once in the app's lifetime) was drawn at the same size and
    // weight as the one used daily, immediately next to it.
    //
    // Now: one row. Source on the left, the daily action and everything else
    // behind Beheer on the right. Nothing was removed — re-scan, skipped items
    // and disconnect all still live here, one tap deeper, which is the right
    // depth for a control you touch once a year.
    return (
      <div style={{ marginBottom: 14 }}>
        <div
          style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 8px 8px 12px",
            background: "#fff", border: "1px solid #e8eaed", borderRadius: 12,
          }}
        >
          <svg
            width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="#5f6368" strokeWidth="1.7" aria-hidden="true" style={{ flexShrink: 0 }}
          >
            <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
            <path d="M3.2 7l8.8 6 8.8-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 7 }}>
            {/* A dot is a FILL, so the bright brand tones are the right ones here
                (see the *Fill note in @/lib/design/tokens). */}
            <span
              style={{
                width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                background: needsReauth ? M3.errorFill : M3.successFill,
              }}
            />
            <span
              style={{
                fontSize: 14, fontWeight: 600, flexShrink: 0,
                color: needsReauth ? M3.error : "#202124",
              }}
            >
              {needsReauth ? `${providerName} — verbinding verlopen` : providerName}
            </span>
            <span
              style={{
                fontSize: 13, color: "#5f6368", minWidth: 0,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              · {status.email}
            </span>
          </div>
          <button
            onClick={() => handleSync()}
            disabled={syncing}
            style={{
              background: syncing ? "#f1f3f4" : "#e8f0fe",
              border: "none", color: syncing ? "#5f6368" : "#1a73e8",
              fontWeight: 600, fontSize: 14, borderRadius: 980,
              padding: "8px 16px", whiteSpace: "nowrap", flexShrink: 0,
              cursor: syncing ? "default" : "pointer",
            }}
          >
            {syncing ? t('act.bezig') : t('ink.sync.knop')}
          </button>
          <button
            onClick={() => setManageOpen((o) => !o)}
            aria-expanded={manageOpen}
            style={{
              background: manageOpen ? "#e8eaed" : "#f8f9fa",
              border: "none", color: "#3c4043",
              fontWeight: 600, fontSize: 14, borderRadius: 980,
              padding: "8px 14px", whiteSpace: "nowrap", flexShrink: 0,
              cursor: "pointer",
            }}
          >
            {t('ink.beheer')}
          </button>
        </div>

        {needsReauth && (
          <div style={{ background: "#FCE8E6", border: "1px solid #F5B5AE", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "#B3261E", marginBottom: 6 }}>
              {t('ink.email.gestopt')}
            </div>
            <div style={{ fontSize: 13, color: "#8C1D18", marginBottom: 10, lineHeight: 1.45 }}>
              Je {providerName}-koppeling is verlopen. Er komen geen nieuwe facturen meer binnen totdat je opnieuw verbindt.
            </div>
            <a
              href={`/api/email/connect?provider=${status.provider}`}
              style={{ display: "inline-block", background: "#B3261E", color: "#fff", borderRadius: 10, padding: "9px 16px", fontWeight: 600, fontSize: 14, textDecoration: "none" }}
            >
              Verbind {providerName} opnieuw
            </a>
          </div>
        )}

        {/* The sync's own progress line stays OUTSIDE the Beheer panel: a running
            import must keep reporting itself whether or not that panel is open. */}
        {syncResult && (
          <div
            style={{
              marginTop: 8, fontSize: 13,
              color: syncResult.startsWith(t('ink.sync.foutPrefix')) ? M3.error : M3.success,
            }}
          >
            {syncResult}
          </div>
        )}

        {manageOpen && (
        <div style={{
          marginTop: 8, padding: "12px 14px",
          background: "#fff", border: "1px solid #e8eaed", borderRadius: 12,
        }}>

        {/* [BACKFILL] Re-scan an earlier period. The daily sync only looks forward, so an
            invoice that was missed at the time (and is now fixable) needs a one-off re-pull.
            Nothing is duplicated — the re-scan imports only what's still missing. */}
        <div>
          {!backfillOpen ? (
            <button
              onClick={() => setBackfillOpen(true)}
              disabled={syncing}
              style={{
                background: "transparent", border: "none",
                color: syncing ? "#dadce0" : "#1a73e8",
                fontSize: 13, fontWeight: 500,
                cursor: syncing ? "default" : "pointer", padding: 0,
              }}
            >
              {t('ink.email.ouderOphalen')}
            </button>
          ) : (
            <div style={{ background: "#f8f9fa", borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 12.5, color: "#3c4043", lineHeight: 1.5, marginBottom: 8 }}>
                {t('ink.backfill.uitleg')}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <DateFieldNL
                  value={backfillDate}
                  max={amsterdamToday()}
                  onChange={setBackfillDate}
                  disabled={syncing}
                  aria-label={t('ink.ophalenVanaf')}
                  style={{
                    border: "1px solid #dadce0", borderRadius: 8, padding: "8px 10px",
                    fontSize: 14, fontFamily: "inherit",
                  }}
                />
                <button
                  onClick={() => handleSync(backfillDate)}
                  disabled={syncing || !backfillDate}
                  style={{
                    background: syncing ? "#e0e0e0" : "#1a73e8",
                    color: syncing ? "#5f6368" : "#fff",
                    border: "none", borderRadius: 8, padding: "8px 16px",
                    fontWeight: 600, fontSize: 14,
                    cursor: syncing || !backfillDate ? "not-allowed" : "pointer",
                  }}
                >
                  {syncing ? t('act.bezig') : t('ink.backfill.knop')}
                </button>
                <button
                  onClick={() => setBackfillOpen(false)}
                  disabled={syncing}
                  style={{
                    background: "transparent", border: "none", color: "#5f6368",
                    fontSize: 13, cursor: syncing ? "default" : "pointer", padding: "8px 4px",
                  }}
                >
                  {t('ink.annuleer')}
                </button>
              </div>
            </div>
          )}
        </div>

        {overgeslagenBlok}

        {/* [INCOMING-CHROME] The destructive one, last and quiet — a text button
            below a rule rather than a red-bordered block beside the daily action.
            It still asks before it acts (handleDisconnect opens the app dialog),
            and it is now labelled with what it does rather than with jargon.
            M3.error, not the bright #ea4335 the old border used: that tone is
            fill-only in the tokens and fails the contrast floor for a word. */}
        <div style={{ borderTop: "1px solid #f1f3f4", marginTop: 14, paddingTop: 12 }}>
          <button
            onClick={handleDisconnect}
            style={{
              background: "transparent", border: "none", color: M3.error,
              fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0,
            }}
          >
            {t('ink.email.verwijderen')}
          </button>
        </div>
        </div>
        )}
      </div>
    );
  }

  // Not connected
  return (
    <div
      style={{
        background: "#f8f9fa", borderRadius: 20,
        padding: "24px 20px", marginBottom: 20, textAlign: "center",
      }}
    >
      <div style={{ fontSize: 44, marginBottom: 12 }}>📬</div>
      <div style={{ fontWeight: 700, fontSize: 17, color: "#202124", marginBottom: 8 }}>
        {t('ink.email.verbind')}
      </div>
      <div
        style={{
          fontSize: 14, color: "#5f6368", lineHeight: 1.5,
          maxWidth: 280, margin: "0 auto 24px",
        }}
      >
        {t('ink.email.automatisch')}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {(["gmail", "outlook"] as const).map((provider) => (
          <a
            key={provider}
            href={`/api/email/connect?provider=${provider}`}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: 10, background: "#fff", border: "1.5px solid #e0e0e0",
              borderRadius: 12, padding: "14px 20px", textDecoration: "none",
              color: "#202124", fontWeight: 600, fontSize: 15,
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            }}
          >
            <span style={{ fontSize: 20 }}>{provider === "gmail" ? "📧" : "📮"}</span>
            {t('ink.email.verbindProvider', { provider: provider === "gmail" ? "Gmail" : "Outlook" })}
          </a>
        ))}
      </div>
      {overgeslagenBlok}
    </div>
  );
}

// ── Confirm-paid modal — review & edit AI-extracted amounts ───────────────────

// [ANDER-TOTAAL] Exported for tests/render, for the same reason InvoiceCard is: the one-tap offer
// below lives in the modal's BODY, and a prop that never arrives there is perfectly typed and
// perfectly invisible to tsc. A render is the only thing that can see it.
export function ConfirmPaidModal({
  invoice,
  onVerify,
  onPay,
  onCancel,
  // [QUEUE-EDIT-UX] When true, the modal opens with the edit fields already
  // active — the card's "Bewerken" entry point skips the extra
  // "Gegevens aanpassen" tap. Optional: the normal Verifiëren flow is unchanged.
  startEditing = false,
  // [LEVERANCIER-KIEZEN] The owner's own suppliers, shown under the name field while they type.
  suppliers = [],
  suppliersUnavailable = false,
  // [TARIEF-GEHEUGEN] Het tarief dat deze leverancier aantoonbaar altijd rekent, met het aantal
  // facturen erachter. Afwezig zodra die leverancier ooit twee tarieven op één factuur zette —
  // dan is er geen tarief en hoort er geen voorstel te staan.
  vendorRate,
}: {
  invoice: IncomingInvoice;
  vendorRate?: { rate: number; basedOn: number; source?: 'history' | 'supplier' };
  // [BRIDGE-B] verify → becomes a SHARED Crediteur (unpaid). pay → mark paid (needs method).
  // [BRIDGE-EXTRACT] amounts now also carries reviewed client_name/invoice_number/invoice_date.
  onVerify: (amounts: {
    total_ex_btw: number; btw_amount: number; total_inc_btw: number;
    client_name: string; invoice_number: string; invoice_date: string;
  }) => void;
  onPay: (
    amounts: {
      total_ex_btw: number; btw_amount: number; total_inc_btw: number;
      client_name: string; invoice_number: string; invoice_date: string;
    },
    method: "bank" | "kas",
    // [BRIDGE-QUARTER] real payment date (YYYY-MM-DD) — Axis 2 / cash
    paymentDate: string
  ) => void;
  onCancel: () => void;
  // [QUEUE-EDIT-UX] open with edit fields active (card "Bewerken" entry point)
  startEditing?: boolean;
  // [LEVERANCIER-KIEZEN] The suppliers to offer under the name field. Absent = the plain text
  // field this modal has always had; the correction still saves exactly as before.
  suppliers?: SupplierChoice[];
  // [NO-SILENT-EMPTY] The list could not be READ — said out loud, never rendered as "none".
  suppliersUnavailable?: boolean;
}) {
  const t = translator(useLocale())
  // [DATE-GATE-FEEDBACK] This modal had no snackbar of its own — see nudgeForDate below.
  const showToast = useToast();
  const [exBtw, setExBtw] = useState(invoice.total_ex_btw || 0);
  const [btwAmount, setBtwAmount] = useState(invoice.btw_amount || 0);
  // [BRIDGE-EXTRACT] inline edit of the AI-extracted vendor / number / date.
  // Edited alongside amounts under the same "Bedragen aanpassen" toggle.
  const [vendor, setVendor] = useState(invoice.client_name || "");
  const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoice_number || "");
  const [invoiceDate, setInvoiceDate] = useState(invoice.invoice_date || "");
  // [DATE-NL] What the owner SEES while typing, in Dutch order. Held next to the ISO value rather
  // than derived from it, because half of "21-01-20" has no ISO to be derived from — and clearing
  // the field on every keystroke is exactly what a derived display would do.
  const [invoiceDateTyped, setInvoiceDateTyped] = useState(() => isoToDutchDate(invoice.invoice_date));
  const [submitting, setSubmitting] = useState(false);
  // [BRIDGE-B] payStep = showing the Bank/Contant choice (after "Markeer als betaald")
  const [payStep, setPayStep] = useState(false);
  // [BRIDGE-QUARTER] real payment date (defaults to today) + confirmation amount.
  // confirmAmount is UI-only for now (NOT stored) — explicit defer per brief §2.
  // [BON-BETAALWIJZE] A bon states WHEN it was settled — that is the date the money actually moved,
  // and it decides the BTW quarter. Defaulting to today put a bon from last quarter in this one.
  // Only a real ISO date is accepted; anything else falls back to today, as before.
  const paperPaidDate = (() => {
    const d = (invoice.field_confidence as { _intake_paid_date?: string } | null)?._intake_paid_date;
    return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  })();
  const [paymentDate, setPaymentDate] = useState(
    paperPaidDate ?? amsterdamToday()
  );
  // [DATE-NL] Same pairing as invoiceDateTyped above.
  const [paymentDateTyped, setPaymentDateTyped] = useState(() =>
    isoToDutchDate(paperPaidDate ?? amsterdamToday())
  );
  const [confirmAmount, setConfirmAmount] = useState("");

  // [AMOUNT-TRIPLET] The total WAS derived and not editable. That guaranteed the identity (ex + btw
  // = total could no longer go wrong) but ran counter to the paper: the total is the most reliable
  // number there is — bold at the bottom, and the amount your bank statement will have to match —
  // while the ex amount is the hard one (Subtotaal? basis? Ex. BTW?). On all four invoices that
  // stalled on this, that was exactly the misread figure, and the owner had to do 1078.46 − 88.73
  // in their head to get there.
  //
  // Now all three are editable and the identity holds after every keystroke — guarded by
  // amount-triplet.ts (pure, 7 tests), not by hope. Touch the total and the EX amount follows; btw
  // stays put unless you type it yourself, because that is the figure that enters the return as
  // deductible input tax and so should jump around least.
  //
  // [PRINTED-TOTAL] Seeded from the STORED total, not from ex + btw.
  //
  // Deriving it was safe only while the stored triplet already added up — and the invoices this
  // editor exists for are exactly the ones where it does not. CAN Vleesgroothandel 2034382 is the
  // case: the reader took the 9% base (973,15) and dropped the invoice's 0% line (−3,86), so
  // ex + btw = 1.060,73 while the paper, and the card above this editor, both say 1.056,87.
  //
  // The editor then opened on a total that matched neither, and — because the confirm sends all
  // three amounts — pressing Verifiëren without touching anything REPLACED the printed total with
  // the derived one. That is the wrong direction of trust: the total is what the owner actually
  // paid and the figure the supplier is most careful with, and this editor's own design treats it
  // as the anchor ("touch the total and the EX amount follows").
  //
  // The fallback stays for a row that genuinely has no stored total (a legacy import), where
  // ex + btw is the only figure available.
  const storedIncl = Number(invoice.total_inc_btw ?? 0);
  const [totalIncBtw, setTotalIncBtw] = useState(
    Number.isFinite(storedIncl) && Math.abs(storedIncl) > 0.005
      ? storedIncl
      : (invoice.total_ex_btw || 0) + (invoice.btw_amount || 0),
  );
  const applyTriplet = (t: { ex: number; btw: number; incl: number }) => {
    setExBtw(t.ex); setBtwAmount(t.btw); setTotalIncBtw(t.incl);
  };
  const triplet = { ex: exBtw, btw: btwAmount, incl: totalIncBtw };

  // [BRIDGE-CREDITNOTA-SIGN] The old `Math.max(0, …)` forced every edited amount ≥ 0, which turned
  // a creditnota positive the moment the user touched a field. A creditnota's amounts follow the
  // safecore rule (evaluateCreditnotaArithmetic): only the NET total must be negative — the ex/BTW
  // signs are NOT constrained (the real Altena case is ex −123, BTW +13,42, totaal −109,58). So for
  // a creditnota we accept the real signed value the reviewer reads off the paper (no clamp); for a
  // normal invoice we keep the ≥ 0 clamp.
  // [KIND-CORRECTION] Here the reviewer can say this is a credit note after all. Without that, the
  // truth could not get in: on the potato invoice (returned container, net −109.58) the clamp pushed
  // every negative amount back to 0, leaving a debt on the books that is really a credit. Ticking it
  // lifts the clamp; the server stores the kind along with it.
  const [declaredCredit, setDeclaredCredit] = useState(false);
  const isCredit = invoice.invoice_type === "creditnota" || declaredCredit;
  const clampAmount = (raw: number) => (isCredit ? raw : Math.max(0, raw));

  // [STATIEGELD-GAT] Wat de import op het papier terugvond voor een optelling die tekortkomt.
  // Alleen gelezen — het zoeken gebeurt op de tekst van het document, bij de import (statiegeld.ts).
  const depositGap = (invoice.field_confidence as { _statiegeld?: DepositGap } | null)?._statiegeld ?? null;

  // [KOMMA-INVOER] What the owner SEES while typing, next to what the triplet HOLDS — the same
  // pairing [DATE-NL] uses above, for the same reason: a display derived from the parsed number
  // eats the keystroke that has not become a number yet. These fields were <input type="number">,
  // and that refused the Dutch decimal comma outright: on the NemaFood invoice the btw is printed
  // 95,54 and the field would not take anything past "95" — the one figure the modal exists to
  // let the owner copy off the paper could not be typed. (It also put a spinner on money, and its
  // parseFloat would have read a pasted "1.160,68" as 1.16.) Text + parseAmountNL reads every
  // ordinary Dutch way of writing an amount; blur snaps the field to the value the triplet holds.
  // Display rounds to the cent; the HELD value stays untouched (the triplet is deliberately
  // unrounded — see amount-triplet.ts). Without the rounding, a derived field paints the float
  // tail: 1160,68 − 95,54 held as 1065.1399999999999 would show as "1065,1399999999999".
  const [amountDraft, setAmountDraft] = useState<{ field: "ex" | "btw" | "incl"; text: string } | null>(null);
  // [NUL-IS-GEEN-INVOER] The display rule lives in amount-triplet.ts, because this exact line was
  // ALSO in InvoiceCorrectionModal — and a rendering rule written twice is one that gets fixed
  // once. A held 0 now shows as an empty box with a placeholder beside it, so the caret no longer
  // lands after a "0" the owner has to delete before typing.
  const amountShown = (field: "ex" | "btw" | "incl", held: number) =>
    amountFieldText(held, amountDraft, field);
  const typeAmount = (field: "ex" | "btw" | "incl", text: string) => {
    setAmountDraft({ field, text });
    const n = clampAmount(parseAmountNL(text));
    applyTriplet(field === "ex" ? setExcl(triplet, n) : field === "btw" ? setBtw(triplet, n) : setIncl(triplet, n));
  };

  // [BRIDGE-B] TRAIL 3 — legal BTW rate must round to 0 / 9 / 21. FLAG, never block.
  // [BTW-MIXED-RATE] A blended rate (e.g. 9%+21% food invoice → ~11%) is valid:
  // any value 0–21 can be a mix of legal NL rates. Only < 0 or > 21 is impossible.
  // [BRIDGE-CREDITNOTA-SIGN] Magnitude ratio (mirrors safecore): |BTW / excl|. On a mixed-sign
  // net-credit (positive goods-BTW over a negative net excl) the raw ratio is negative, so the old
  // `btwRate < 0` test false-flagged a correctly-read Altena-style creditnota. Only a magnitude
  // above 21% is actually impossible for a (blended) NL rate.
  // [BTW-TARIEF] Which standard rate this invoice is ALREADY at, for the button row to light up.
  // null is a real answer: a mixed 9%/21% wholesale invoice lands around 11%, belongs to no
  // standard rate, and showing no highlight is the honest way to say so.
  const huidigTarief = rateOfTriplet(triplet);
  const btwRate = Math.abs(exBtw) > 0.005 ? Math.round(Math.abs(btwAmount / exBtw) * 100) : null;
  const rateFlag = btwRate !== null && btwRate > 21;

  // [BRIDGE-EXTRACT] N-N page-number pattern in the invoice number → soft flag
  // (e.g. "1-1" likely a page indicator the AI mistook for a number). Never blocks.
  const numberFlag = /^\d{1,2}\s*[-/]\s*\d{1,2}$/.test(invoiceNumber.trim());

  // [BRIDGE-EXTRACT] Per-field low-confidence flags — the AI told us which fields
  // it was unsure about. Threshold 0.7: below = ask the user to confirm. An empty
  // field (guard nulled it → conf 0) also flags. These are SOFT (never block).
  const fc = invoice.field_confidence;
  // [LEVERANCIER-STAAT-IN-HET-LOGO] One threshold, imported. This was a third copy of 0.7 —
  // beside import-health's and the visual re-read's — and the three answer the same question in
  // sequence: below this line the app looks at the page again, and only if it is STILL unsure does
  // this ⚠️ appear. Two different lines would put a warning on invoices the app had already fixed.
  const LOW = LOW_CONFIDENCE;
  const vendorLow = (fc?.vendor ?? 1) < LOW || !vendor.trim();
  const numberLow = (fc?.invoice_number ?? 1) < LOW || numberFlag;
  const dateLow = (fc?.invoice_date ?? 1) < LOW;
  const anyLow = vendorLow || numberLow || dateLow;

  // Auto-open the edit fields when the AI flagged any field as uncertain, so the
  // user lands directly on what needs confirming instead of having to find it.
  // [QUEUE-EDIT-UX] Also open when entered via the card's "Bewerken" button.
  // [DATE-GATE] Open the editor whenever the invoice date is missing so the
  // reviewer immediately sees the (required) date input.
  const [editing, setEditing] = useState(anyLow || startEditing || !invoiceDate);

  const amounts = {
    total_ex_btw: exBtw,
    btw_amount: btwAmount,
    total_inc_btw: totalIncBtw,
    // [KIND-CORRECTION] Only sent when the reviewer ticked it themselves.
    ...(declaredCredit ? { is_credit_note: true } : {}),
    // [BRIDGE-EXTRACT] reviewed metadata — persisted by the confirm route
    client_name: vendor.trim(),
    invoice_number: invoiceNumber.trim(),
    invoice_date: invoiceDate.trim(),
  };

  // [DATE-GATE] An incoming invoice may not be confirmed without a real invoice
  // date (the date sets the tax period). Mirror of the server gate: nudge inline
  // and open the editor instead of firing a raw server error.
  const dateMissing = !invoiceDate.trim();
  // [DATE-GATE-FEEDBACK] Opening the editor was the whole response — and the editor is ALREADY open
  // in this case (`editing` initialises to !invoiceDate), so tapping the green button produced no
  // visible reaction at all. There is a red line by the field, but a button that answers nothing
  // reads as broken, not as refused. Say it, and put the cursor where the answer goes.
  const dateInputRef = useRef<HTMLInputElement>(null);
  const nudgeForDate = () => {
    // Come BACK to the review step first. handlePay is only reachable once payStep is true, and
    // the whole review section — the date input this points at included — lives in the !payStep
    // branch. Without this, setEditing(true) changed nothing on screen, the ref was null so the
    // focus/scroll did nothing, and the toast asked the owner to fill in a field that was not
    // being rendered. A message about an invisible field is worse than the silence it replaced.
    setPayStep(false);
    setEditing(true);
    showToast(t('ink.datumEerst'));
    setTimeout(() => {
      dateInputRef.current?.focus();
      dateInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  };
  const handleVerify = () => {
    if (dateMissing) { nudgeForDate(); return; }
    setSubmitting(true);
    onVerify(amounts);
  };
  const handlePay = (method: "bank" | "kas") => {
    if (dateMissing) { nudgeForDate(); return; }
    setSubmitting(true);
    onPay(amounts, method, paymentDate);
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        zIndex: 2000,
      }}
      onClick={onCancel}
    >
      <div className="sheet-scroll"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: "20px 20px 0 0",
          padding: "24px 20px",
          paddingBottom: "calc(24px + var(--bottom-nav-h) + env(safe-area-inset-bottom))",
          width: "100%", maxWidth: 430,
        }}
      >
        {!payStep ? (
          <>
            <div style={{ fontWeight: 700, fontSize: 19, color: "#202124", marginBottom: 4 }}>
              {t('ink.factuurBevestigen')}
            </div>
            <div style={{ fontSize: 14, color: "#5f6368", marginBottom: 20 }}>
              {t('ink.controleerBedragen')}
            </div>

            {/* [GEEN-BTW-SOORT] Niet elke 21% is BTW die je mag terugvragen.
                Aanleiding: factuur 142257742 van Coöperatie Univé, € 195,28 + € 41,01, netjes
                gelezen, netjes opgeteld, langs elke poort in deze app — en die € 41,01 is
                assurantiebelasting. Ook 21%, staat op precies de plek waar BTW zou staan, en
                is niet aftrekbaar.

                Dit staat BOVEN de reparatievoorstellen met opzet: die gaan over of de
                bedragen kloppen, deze gaat over of het bedrag wel BTW ís. Een verkeerd
                antwoord op de tweede vraag maakt de eerste zinloos.

                Het is een vraag, geen oordeel, en dat is geen beleefdheid: bij verhuur is 21%
                juist heel vaak correct (huurder en verhuurder mogen kiezen voor btw-belaste
                verhuur), en een verzekeraar mag ook een gewone belaste dienst factureren.
                De app verandert dus niets — ze wijst, de eigenaar beslist. */}
            {(() => {
              const twijfel = doubtAboutInputVat({
                supplierName: invoice.client_name,
                btwAmount: invoice.btw_amount,
                totalExBtw: invoice.total_ex_btw,
              })
              if (!twijfel) return null
              return (
                <div style={{
                  marginTop: 10, padding: "10px 12px", borderRadius: 10,
                  background: "#fff8e1", border: "1px solid #e0a94f",
                }}>
                  <div style={{ fontSize: 12.5, color: "#9a5b00", lineHeight: 1.5 }}>
                    {twijfel.message}
                  </div>
                  {/* Het wetsartikel erbij, zodat een boekhouder de bewering kan controleren
                      in plaats van hem te moeten geloven. */}
                  <div style={{ fontSize: 11.5, color: "#a6773a", marginTop: 4 }}>
                    {twijfel.wet}
                  </div>
                </div>
              )
            })()}

            {/* [IMPORT-MONITOR] Part 3 — surface the arithmetic WHY in the modal.
                The per-field ⚠️ flags below already cover vendor/number/date and
                an unexpected BTW rate. This adds the one thing the modal never
                showed: the stored _safecore reason from an email-path arithmetic
                hold (e.g. "excl + BTW ≠ totaal"), so the owner sees exactly what
                to fix. Only renders when the health verdict flags arithmetic and
                a concrete reason exists. */}
            {invoice.health.flags.arithmetic &&
              invoice.health.reasons.length > 0 && (
                <div
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 8,
                    padding: "12px 14px", marginBottom: 16,
                    background: "#fff4e5", borderRadius: 12,
                    border: "1px solid #ffd9a8",
                  }}
                >
                  <span style={{ fontSize: 15, lineHeight: 1.3 }}>⚠️</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12.5, color: "#9a5b00", lineHeight: 1.5 }}>
                    {invoice.health.reasons
                      .map((r) => r.charAt(0).toUpperCase() + r.slice(1))
                      .join(" · ")}
                    . Controleer en pas de bedragen aan.
                  </span>
                  {/* [ONE-TAP-REPAIR] The gate already computed the answer — offer it as an action.
                      A warning that names a figure ("dan hoort excl. BTW € 969,29 te zijn") and then
                      makes the owner retype it is asking them to copy a number the app is holding.
                      And on the invoice that prompted this the app was RIGHT: CAN Vleesgroothandel
                      2034382 prints 9% over 973,15 plus a 0% line of −3,86, so the true ex is 969,29
                      — exactly what the warning said.

                      BOTH readings are offered, never one. Arithmetic cannot tell WHICH figure is
                      the wrong one: repairing the ex and repairing the btw both satisfy
                      ex + btw = totaal at a legal rate. Picking for the owner would be a guess
                      wearing the app's authority, and this is the screen where a wrong amount
                      enters the books. The paper decides; these buttons only spare the typing.

                      Nothing is saved by tapping — the fields fill and the owner still confirms. */}
                  {/* [ANDER-TOTAAL] The document's own totals block, when the one we read is not
                      on it. [ONE-TAP-REPAIR] below cannot help here: it repairs ex OR btw to match
                      a total it treats as given, and here the TOTAL is what is in doubt.

                      Reached by a second, blind read of the page ("write down every amount you can
                      see") that failed to find our total and did find a triple that adds up to the
                      cent. On the invoice this came from: we read € 1.149,56; the document says
                      € 1.065,14 + € 95,54 = € 1.160,68.

                      One tap fills the three fields and opens the editor. Nothing is saved — the
                      owner still confirms, with the paper in hand. Both figures come from a model
                      reading a scan, so the app may not pick; it may only stop making the owner
                      type a number it is already holding. */}
                  {invoice.health.alternativeTotals && (() => {
                    const alt = invoice.health.alternativeTotals!
                    return (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 12, color: "#9a5b00", marginBottom: 6, lineHeight: 1.45 }}>
                          {t('ink.bedrag.staatOp')}
                        </div>
                        <button
                          type="button"
                          onClick={() => { applyTriplet({ ex: alt.ex, btw: alt.btw, incl: alt.inc }); setEditing(true) }}
                          style={{
                            padding: "7px 12px", borderRadius: 9, background: "#fff",
                            border: "1px solid #e0a94f", color: "#9a5b00",
                            fontWeight: 600, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit",
                          }}
                        >
                          {t('ink.bedrag.neemOver', { bedrag: NL_CURRENCY.format(alt.inc) })}
                        </button>
                      </div>
                    )
                  })()}
                  {/* [TARIEF-GEHEUGEN] De uitsplitsing is NIET gelezen — alleen het totaal stond er.
                      Dan valt er niets te reconstrueren uit de bedragen zelf (dat probeerde het blok
                      hieronder, en het bood "excl. BTW = het hele totaal" aan: 0 % is een geldig
                      Nederlands tarief, dus dat gold als reparatie. Accepteren boekt een
                      groothandelsfactuur zonder één cent voorbelasting.)

                      Wat er wél is, staat in de administratie van de eigenaar zelf: dezelfde
                      leverancier, dezelfde factuur, keer op keer hetzelfde tarief. Dat is geen
                      gok maar een telling, en de zin noemt hem — "12 eerdere facturen" is te
                      controleren, "wij denken 21 %" is een machine die om vertrouwen vraagt.

                      Het VULT alleen de velden; bevestigen blijft de eigenaar. */}
                  {(() => {
                    const rec0 = reconcileBtw(invoice.total_ex_btw, invoice.btw_amount, invoice.total_inc_btw)
                    if (rec0.ok || rec0.splitWasRead || !vendorRate) return null
                    const voorstel = proposeSplit(invoice.total_inc_btw, vendorRate.rate)
                    if (!voorstel) return null
                    return (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 12, color: "#9a5b00", marginBottom: 6, lineHeight: 1.45 }}>
                          {/* [LEVERANCIER-STANDAARD] A rate the owner SET has no count to cite: it is a
                              decision, and the sentence says so instead of claiming a history. */}
                          {vendorRate.source === 'supplier'
                            ? t('ink.bedrag.tariefIngesteld', { tarief: String(vendorRate.rate) })
                            : t('ink.bedrag.tariefGeheugen', {
                              tarief: String(vendorRate.rate),
                              aantal: String(vendorRate.basedOn),
                            })}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            applyTriplet({ ex: voorstel.totalExBtw, btw: voorstel.btwAmount, incl: invoice.total_inc_btw })
                            setEditing(true)
                          }}
                          style={{
                            padding: "7px 12px", borderRadius: 9, background: "#fff",
                            border: "1px solid #e0a94f", color: "#9a5b00",
                            fontWeight: 600, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit",
                          }}
                        >
                          {t('ink.bedrag.vulSplitsing', {
                            excl: NL_CURRENCY.format(voorstel.totalExBtw),
                            btw: NL_CURRENCY.format(voorstel.btwAmount),
                          })}
                        </button>
                      </div>
                    )
                  })()}
                  {(() => {
                    const rec = reconcileBtw(invoice.total_ex_btw, invoice.btw_amount, invoice.total_inc_btw)
                    if (rec.ok) return null
                    const stored = invoice.total_inc_btw
                    const options: Array<{ label: string; t: { ex: number; btw: number; incl: number } }> = []
                    if (rec.exclRepairPossible) {
                      options.push({
                        label: t('ink.bedrag.exclIs', { bedrag: NL_CURRENCY.format(rec.impliedExcl) }),
                        t: { ex: rec.impliedExcl, btw: invoice.btw_amount, incl: stored },
                      })
                    }
                    if (rec.btwRepairPossible) {
                      options.push({
                        label: t('ink.bedrag.btwIs', { bedrag: NL_CURRENCY.format(rec.impliedBtw) }),
                        t: { ex: invoice.total_ex_btw, btw: rec.impliedBtw, incl: stored },
                      })
                    }
                    if (options.length === 0) return null
                    return (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 12, color: "#9a5b00", marginBottom: 6, lineHeight: 1.45 }}>
                          {t('ink.bedrag.welkeKlopt', { bedrag: NL_CURRENCY.format(stored) })}
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {options.map((o) => (
                            <button
                              key={o.label}
                              type="button"
                              onClick={() => { applyTriplet(o.t); setEditing(true) }}
                              style={{
                                padding: "7px 12px", borderRadius: 9, background: "#fff",
                                border: "1px solid #e0a94f", color: "#9a5b00",
                                fontWeight: 600, fontSize: 12.5, cursor: "pointer", fontFamily: "inherit",
                              }}
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })()}
                  </div>
                </div>
              )}

            {/* Amounts breakdown */}
            <div
              style={{
                background: "#f8f9fa", borderRadius: 14,
                padding: "16px", marginBottom: 16,
              }}
            >
              {/* Excl BTW */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 14, color: "#5f6368" }}>{t('ink.bedragExcl')}</span>
                {editing ? (
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amountShown("ex", exBtw)}
                    onChange={(e) => typeAmount("ex", e.target.value)}
                    onBlur={() => setAmountDraft(null)}
                    // [NUL-IS-GEEN-INVOER] Tapping the field selects what is in it, so the
                    // first keystroke REPLACES the amount instead of appending to it.
                    onFocus={(e) => e.currentTarget.select()}
                    placeholder={AMOUNT_PLACEHOLDER}
                    style={{
                      width: 110, padding: "6px 10px", fontSize: 16,
                      borderRadius: 8, border: "1.5px solid #1a73e8",
                      textAlign: "end", outline: "none",
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 600, color: "#202124" }}>
                    {formatAmount(exBtw)}
                  </span>
                )}
              </div>

              {/* BTW amount */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: rateFlag ? 6 : 12 }}>
                <span style={{ fontSize: 14, color: "#5f6368" }}>BTW</span>
                {editing ? (
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amountShown("btw", btwAmount)}
                    onChange={(e) => typeAmount("btw", e.target.value)}
                    onBlur={() => setAmountDraft(null)}
                    // [NUL-IS-GEEN-INVOER] Tapping the field selects what is in it, so the
                    // first keystroke REPLACES the amount instead of appending to it.
                    onFocus={(e) => e.currentTarget.select()}
                    placeholder={AMOUNT_PLACEHOLDER}
                    style={{
                      width: 110, padding: "6px 10px", fontSize: 16,
                      borderRadius: 8,
                      border: `1.5px solid ${rateFlag ? "#EA8600" : "#1a73e8"}`,
                      textAlign: "end", outline: "none",
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 600, color: rateFlag ? "#EA8600" : "#202124" }}>
                    {formatAmount(btwAmount)}
                  </span>
                )}
              </div>

              {/* [BRIDGE-B] TRAIL 3 flag — non-blocking warning on an unexpected BTW rate */}
              {rateFlag && (
                <div style={{ fontSize: 12, color: "#EA8600", lineHeight: 1.4, marginBottom: 12, display: "flex", gap: 6 }}>
                  <span>⚠️</span>
                  <span>BTW-tarief lijkt {btwRate}% — controleer de bedragen (verwacht 0%, 9% of 21%).</span>
                </div>
              )}

              {/* Divider */}
              <div style={{ height: 1, background: "#dadce0", margin: "12px 0" }} />

              {/* [AMOUNT-TRIPLET] The total — now editable, because THIS is the figure printed most
                  clearly on the invoice. Copy it over and the ex amount follows by itself, with
                  nothing left to subtract. */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#202124" }}>{t('ink.totaal')}</span>
                {editing ? (
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amountShown("incl", totalIncBtw)}
                    onChange={(e) => typeAmount("incl", e.target.value)}
                    onBlur={() => setAmountDraft(null)}
                    // [NUL-IS-GEEN-INVOER] Tapping the field selects what is in it, so the
                    // first keystroke REPLACES the amount instead of appending to it.
                    onFocus={(e) => e.currentTarget.select()}
                    placeholder={AMOUNT_PLACEHOLDER}
                    aria-label={t('ink.totaalUitleg')}
                    style={{
                      width: 130, padding: "8px 10px", fontSize: 18, fontWeight: 700,
                      borderRadius: 10, border: "1.5px solid #1a73e8",
                      textAlign: "end", outline: "none", color: "#202124",
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 18, fontWeight: 700, color: "#202124" }}>
                    {formatAmount(totalIncBtw)}
                  </span>
                )}
              </div>
              {/* [BTW-TARIEF] GEMELD: "als ik het bedrag zonder btw typ moet de btw automatisch
                  berekend worden". Dat kán niet uit dat bedrag: € 679,33 is tegelijk een 9%- en een
                  21%-factuur totdat iemand zegt welke. Een geraden btw is een geraden voorbelasting,
                  en dat is de richting die je met de Belastingdienst corrigeert.

                  Dus vragen we het tarief in plaats van het te raden, en splitsen we vanuit het
                  TOTAAL — hetzelfde argument als setIncl: dat is het best leesbare getal op het
                  papier. De knop bestaat alleen zolang er een totaal is zónder btw; zodra er btw
                  staat verdwijnt hij, want dan is er niets te herstellen. */}
              {/* GEMELD, daarna: de knoppen verschenen alleen zolang de btw nog 0 was. Te streng —
                  juist op een factuur die "onzeker gelezen" is STAAT er al een btw-bedrag, en dat
                  is precies het moment waarop de eigenaar wil kunnen zeggen "dit is 21%". */}
              {editing && Math.abs(totalIncBtw) > 0.005 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12.5, color: "#5f6368", marginBottom: 6, lineHeight: 1.4 }}>
                    {huidigTarief === null ? t('corr.tarief.vraag') : t('corr.tarief.nu', { tarief: huidigTarief })}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {NL_BTW_RATES.map((tarief) => (
                      <button
                        key={tarief}
                        type="button"
                        // The row is a READOUT as well as a control: the rate the invoice is
                        // already at is filled in, so an accidental tap is visible immediately.
                        aria-pressed={huidigTarief === tarief}
                        onClick={() => applyTriplet(splitByRate(totalIncBtw, tarief))}
                        style={{
                          flex: 1, minHeight: 44, borderRadius: 12,
                          border: `${huidigTarief === tarief ? 2 : 1}px solid #1a73e8`,
                          background: huidigTarief === tarief ? "#1a73e8" : "#e8f0fe",
                          color: huidigTarief === tarief ? "#fff" : "#1a4fa0",
                          fontSize: 13.5, fontWeight: 600,
                          cursor: "pointer", fontFamily: "inherit", padding: "10px 8px", lineHeight: 1.35,
                        }}
                      >
                        {t('corr.tarief.knop', {
                          tarief,
                          btw: formatAmount(Math.abs(splitByRate(totalIncBtw, tarief).btw)),
                        })}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 11.5, color: "#80868b", marginTop: 6, lineHeight: 1.4 }}>
                    {t('corr.tarief.uitleg')}
                  </div>
                </div>
              )}

              {/* [STATIEGELD-GAT] Eén tik, want het rekenwerk is al gedaan.
                  GEMELD: "het lukt de app niet om statiegeld te verwerken". De factuur van Elegance
                  Brands bleef hangen op "excl. + btw komt niet uit op het totaal", terwijl het
                  ontbrekende bedrag één regel hoger op het papier stond als "Totaal Statiegeld".
                  Het verschil ligt vast door de optelling, en het woord ernaast is door de import
                  op het document zelf teruggevonden (statiegeld.ts) — dus valt er niets meer uit
                  te rekenen, alleen nog te bevestigen. De btw beweegt niet mee: over statiegeld
                  wordt er geen gerekend, en dat is precies waarom dit veilig aan te bieden is.
                  Verdwijnt zodra de bedragen kloppen — de knop bestaat alleen zolang er een gat is. */}
              {depositGap && Math.abs(round2(totalIncBtw - exBtw - btwAmount)) > 0.02 && (
                <button
                  type="button"
                  onClick={() => {
                    if (!editing) setEditing(true);
                    applyTriplet(setExcl(triplet, clampAmount(round2(exBtw + depositGap.gap))));
                  }}
                  style={{
                    marginTop: 10, width: "100%", minHeight: 44, borderRadius: 12, border: "1px solid #1a73e8",
                    background: "#e8f0fe", color: "#1a4fa0", fontSize: 13.5, fontWeight: 600,
                    cursor: "pointer", fontFamily: "inherit", padding: "10px 12px", lineHeight: 1.4,
                  }}
                >
                  {t('ink.statiegeld.meetellen', {
                    bedrag: formatAmount(Math.abs(depositGap.gap)),
                    woord: depositGap.label,
                  })}
                </button>
              )}
              {editing && (
                <div style={{ fontSize: 12, color: "#5f6368", lineHeight: 1.4, marginTop: 8 }}>
                  {t('corr.bedragUitleg')} {t('corr.statiegeld')}
                </div>
              )}

              {/* [KIND-CORRECTION] Without this checkbox the truth could not get in on a net
                  negative invoice: the clamp pushed every minus amount back to 0. Only shown on a
                  row still stored as an ordinary invoice — an already correct credit note does not
                  need it. */}
              {editing && invoice.invoice_type !== "creditnota" && (
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 10, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={declaredCredit}
                    onChange={(e) => setDeclaredCredit(e.target.checked)}
                    style={{ marginTop: 2, width: 16, height: 16, accentColor: "#0B8043" }}
                  />
                  <span style={{ fontSize: 12, color: "#3c4043", lineHeight: 1.4 }}>
                    <strong>{t('ink.isCreditnota')}</strong>{t('corr.creditUitleg')}
                  </span>
                </label>
              )}
            </div>

            {/* [BRIDGE-EXTRACT] Vendor / number / date — editable under the same toggle */}
            <div
              style={{
                background: "#f8f9fa", borderRadius: 14,
                padding: "16px", marginBottom: 16,
              }}
            >
              {/* [BRIDGE-EXTRACT] AI-uncertainty banner — asks the user to confirm
                  the specific fields the AI was not sure about. Soft, never blocks. */}
              {anyLow && (
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "10px 12px", marginBottom: 14,
                  background: "#fff4e5", borderRadius: 10,
                  border: "1px solid #ffd9a8",
                }}>
                  <span style={{ fontSize: 14, lineHeight: 1.3 }}>💡</span>
                  <span style={{ fontSize: 12.5, color: "#9a5b00", lineHeight: 1.4 }}>
                    {t('ink.onzeker.zin', {
                      velden: [
                        vendorLow ? t('ink.onzeker.leverancier') : null,
                        numberLow ? t('ink.onzeker.nummer') : null,
                        dateLow ? t('ink.onzeker.datum') : null,
                      ].filter(Boolean).join(", "),
                    })}
                  </span>
                </div>
              )}

              {/* Vendor */}
              {/* [LEVERANCIER-KIEZEN] alignItems flex-start, not center: the picker under the field
                  grows downward, and a centred label would drift down with it. */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 10 }}>
                <span style={{ fontSize: 14, color: vendorLow ? "#EA8600" : "#5f6368", flexShrink: 0, fontWeight: vendorLow ? 600 : 400, marginTop: editing ? 8 : 0 }}>
                  {t('inkoop.leverancier')} {vendorLow && "⚠️"}
                </span>
                {editing ? (
                  /* [LEVERANCIER-KIEZEN] The suppliers this owner already has, under the field
                     while they type. Retyping a company name from memory is how one company ends
                     up as two supplier rows with the crediteurenstand split between them — see the
                     header of supplier-suggest.ts. */
                  <SupplierNameInput
                    value={vendor}
                    onChange={setVendor}
                    options={suppliers}
                    unavailable={suppliersUnavailable}
                    wrapperStyle={{ flex: 1, minWidth: 0 }}
                    inputStyle={{
                      padding: "6px 10px", fontSize: 15,
                      borderRadius: 8, border: "1.5px solid #1a73e8",
                      textAlign: "end", outline: "none",
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 600, color: "#202124", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {vendor || "—"}
                  </span>
                )}
              </div>

              {/* Invoice number */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: numberFlag ? 6 : 12, gap: 10 }}>
                <span style={{ fontSize: 14, color: "#5f6368", flexShrink: 0 }}>{t('ink.factuurnummer')}</span>
                {editing ? (
                  <input
                    type="text"
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    style={{
                      flex: 1, minWidth: 0, padding: "6px 10px", fontSize: 15,
                      borderRadius: 8,
                      border: `1.5px solid ${numberFlag ? "#EA8600" : "#1a73e8"}`,
                      textAlign: "end", outline: "none",
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 600, color: numberFlag ? "#EA8600" : "#202124" }}>
                    {invoiceNumber || "—"}
                  </span>
                )}
              </div>

              {/* [BRIDGE-EXTRACT] N-N flag — likely a page number, not an invoice number */}
              {numberFlag && (
                <div style={{ fontSize: 12, color: "#EA8600", lineHeight: 1.4, marginBottom: 12, display: "flex", gap: 6 }}>
                  <span>⚠️</span>
                  <span>&ldquo;{invoiceNumber}&rdquo; lijkt een paginanummer — controleer het factuurnummer.</span>
                </div>
              )}

              {/* Invoice date */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, color: (dateLow || dateMissing) ? "#EA8600" : "#5f6368", flexShrink: 0, fontWeight: (dateLow || dateMissing) ? 600 : 400 }}>
                  Factuurdatum {(dateLow || dateMissing) && "⚠️"}
                </span>
                {editing ? (
                  <input
                    type="text"
                    inputMode="numeric"
                    ref={dateInputRef}
                    placeholder={DUTCH_DATE_PLACEHOLDER}
                    value={formatDutchDateInput(invoiceDateTyped)}
                    onChange={(e) => {
                      const shown = formatDutchDateInput(e.target.value)
                      setInvoiceDateTyped(shown)
                      setInvoiceDate(dutchDateToIso(shown) ?? "")
                    }}
                    style={{
                      padding: "6px 10px", fontSize: 15,
                      borderRadius: 8, border: "1.5px solid #1a73e8",
                      textAlign: "end", outline: "none",
                    }}
                  />
                ) : (
                  <span style={{ fontSize: 15, fontWeight: 600, color: "#202124" }}>
                    {/* [QUEUE-EDIT-UX] NL format (19-05-2026), not raw ISO — the
                        card already does this; the modal forgot. The edit
                        <input type="date"> keeps ISO (browser requirement). */}
                    {invoiceDate ? formatDate(invoiceDate) : "—"}
                  </span>
                )}
              </div>
              {dateMissing && (
                <div style={{ fontSize: 12.5, color: M3.error, textAlign: "end", marginTop: 6 }}>
                  {t('ink.datumOntbreekt')}
                </div>
              )}
            </div>

            {/* Edit toggle */}
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                style={{
                  width: "100%", padding: "10px", marginBottom: 10,
                  background: "transparent", border: "none",
                  color: "#1a73e8", fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}
              >
                {/* [QUEUE-EDIT-UX] "Gegevens" not "Bedragen" — the toggle also
                    opens vendor / invoice number / date, not just amounts. */}
                Gegevens aanpassen
              </button>
            )}

            {/* [SMART-INTAKE] When the intake router flagged this as a paid bon,
                surface "Markeer als betaald" as the PRIMARY action (the human
                still confirms Bank/Contant). Otherwise the normal order:
                verify (unpaid Crediteur) primary, mark-paid secondary. */}
            {fc?._intake_suggest === "paid" ? (
              <>
                <div style={{
                  display: "flex", alignItems: "center", gap: 6, marginBottom: 10,
                  padding: "8px 12px", borderRadius: 10, background: "#e8f5e9",
                  color: "#1b5e20", fontSize: 13, fontWeight: 600,
                }}>
                  <span style={{ fontSize: 16 }}>🧾</span>
                  {t('ink.kassabon')}
                </div>

                {/* PRIMARY — mark as paid (suggested for a bon) */}
                <button
                  onClick={() => setPayStep(true)}
                  disabled={submitting}
                  style={{
                    width: "100%", padding: "16px", borderRadius: 14,
                    background: submitting ? "#dadce0" : "#34a853",
                    color: "#fff", border: "none", fontWeight: 700, fontSize: 16,
                    cursor: submitting ? "not-allowed" : "pointer", marginBottom: 8,
                  }}
                >
                  {t('ink.markeerBetaald')}
                </button>

                {/* SECONDARY — verify as unpaid (if the bon is actually not paid) */}
                <button
                  onClick={handleVerify}
                  disabled={submitting}
                  style={{
                    width: "100%", padding: "14px", borderRadius: 14,
                    background: "#e8f0fe", color: "#1a73e8",
                    border: "1.5px solid #1a73e8",
                    fontWeight: 600, fontSize: 15,
                    cursor: submitting ? "not-allowed" : "pointer", marginBottom: 8,
                  }}
                >
                  {submitting ? t('act.bezig') : t('ink.tochNietBetaald')}
                </button>
              </>
            ) : (
              <>
                {/* PRIMARY — verify (becomes a shared Crediteur, unpaid) */}
                <button
                  onClick={handleVerify}
                  disabled={submitting}
                  style={{
                    width: "100%", padding: "16px", borderRadius: 14,
                    background: submitting ? "#dadce0" : "#34a853",
                    color: "#fff", border: "none", fontWeight: 700, fontSize: 16,
                    cursor: submitting ? "not-allowed" : "pointer", marginBottom: 8,
                  }}
                >
                  {submitting ? t('act.bezig') : t('ink.bevestigVerifieer')}
                </button>

                {/* SECONDARY — mark as paid → opens Bank/Contant choice */}
                <button
                  onClick={() => setPayStep(true)}
                  disabled={submitting}
                  style={{
                    width: "100%", padding: "14px", borderRadius: 14,
                    background: "#e8f0fe", color: "#1a73e8",
                    border: "1.5px solid #1a73e8",
                    fontWeight: 600, fontSize: 15,
                    cursor: submitting ? "not-allowed" : "pointer", marginBottom: 8,
                  }}
                >
                  {t('ink.markeerBetaald')}
                </button>
              </>
            )}

            {/* Cancel */}
            <button
              onClick={onCancel}
              disabled={submitting}
              style={{
                width: "100%", padding: "14px", borderRadius: 14,
                background: "#f8f9fa", color: "#202124", border: "none",
                fontWeight: 600, fontSize: 15, cursor: "pointer",
              }}
            >
              {t('ink.annuleren')}
            </button>
          </>
        ) : (
          /* [BRIDGE-B] Payment-method step — mirrors the outgoing "mark paid" dialog */
          <>
            <div style={{ fontWeight: 700, fontSize: 19, color: "#202124", marginBottom: 4 }}>
              {t('ink.hoeBetaald')}
            </div>
            <div style={{ fontSize: 14, color: "#5f6368", marginBottom: 20 }}>
              {t('ink.betaaldUitleg')}
            </div>

            {/* [BRIDGE-QUARTER] Real payment date — the day the money actually
                moved. Defaults to today; the user corrects it if they paid earlier. */}
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#202124", marginBottom: 6 }}>
              {t('ink.betaaldatum')}
            </label>
            <input
              type="text"
              inputMode="numeric"
              placeholder={DUTCH_DATE_PLACEHOLDER}
              value={formatDutchDateInput(paymentDateTyped)}
              onChange={(e) => {
                const shown = formatDutchDateInput(e.target.value)
                setPaymentDateTyped(shown)
                setPaymentDate(dutchDateToIso(shown) ?? "")
              }}
              disabled={submitting}
              style={{
                width: "100%", padding: "12px 14px", borderRadius: 12,
                border: "1px solid #dadce0", fontSize: 15, marginBottom: 14,
                fontFamily: "inherit", color: "#202124", background: "#fff",
                boxSizing: "border-box",
              }}
            />

            {/* [BRIDGE-QUARTER] Confirmation amount — UI only for now (not stored).
                Explicit defer per brief §2: helps the user sanity-check, no DB write. */}
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#202124", marginBottom: 6 }}>
              {t('ink.betaaldBedrag')} <span style={{ color: "#5f6368", fontWeight: 400 }}>{t('ink.optioneel')}</span>
            </label>
            <input
              // [KOMMA-INVOER] Text, not number: the owner copies this off a Dutch bank app with a
              // comma. The state is already the raw string (UI-only, not stored), so only the type
              // and the placeholder's decimal separator had to change.
              type="text"
              inputMode="decimal"
              placeholder={totalIncBtw.toFixed(2).replace(".", ",")}
              value={confirmAmount}
              onChange={(e) => setConfirmAmount(e.target.value)}
              disabled={submitting}
              style={{
                width: "100%", padding: "12px 14px", borderRadius: 12,
                border: "1px solid #dadce0", fontSize: 15, marginBottom: 20,
                fontFamily: "inherit", color: "#202124", background: "#fff",
                boxSizing: "border-box",
              }}
            />

            {/* [BON-BETAALWIJZE] A till slip says how it was settled — "Bankpas 70,29", "KONTANT
                120,00 Wisselgeld 7,10", often with the last four digits of the card. bon-betaalwijze.ts
                has read that line, and only that line, since it was written: the printed word beats
                any interpretation of it. It was stored in field_confidence and read by NOTHING, so
                the app knew the answer and asked the question anyway — two identical green buttons,
                every bon, forever.
                Now the paper's answer leads. It is PRE-SELECTED, never auto-booked: the owner still
                taps, and the other route stays one tap away for when the paper is wrong (a private
                card, a colleague's pass). Where the paper said nothing, both stay equal and the
                question is asked honestly — gok slim, vraag alleen als we het niet weten. */}
            {(() => {
              const zeker = fc?._intake_paid_method_zeker === true;
              const uitPapier = zeker && (fc?._intake_paid_method === "bank" || fc?._intake_paid_method === "kas")
                ? fc._intake_paid_method
                : null;
              const knop = (method: "bank" | "kas", label: string) => {
                const geraden = uitPapier === method;
                const anders = uitPapier !== null && !geraden;
                return (
                  <button
                    key={method}
                    onClick={() => handlePay(method)}
                    disabled={submitting}
                    style={{
                      flex: 1, padding: "16px", borderRadius: 14, fontSize: 16,
                      fontWeight: anders ? 600 : 700,
                      background: submitting ? "#dadce0" : anders ? "#fff" : "#34a853",
                      color: anders ? "#3c4043" : "#fff",
                      border: anders ? "1.5px solid #dadce0" : "none",
                      cursor: submitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {label}
                  </button>
                );
              };
              return (
                <>
                  {uitPapier && (
                    <div style={{
                      display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10,
                      padding: "10px 12px", borderRadius: 10, background: "#e8f0fe", color: "#174ea6",
                      fontSize: 12.5, lineHeight: 1.5,
                    }}>
                      <span style={{ fontSize: 14, lineHeight: 1.2 }}>🧾</span>
                      <span>
                        {t('ink.bonVermeldt')} <strong>{fc?._intake_paid_evidence || (uitPapier === "kas" ? t('ink.papier.contant') : t('ink.papier.bankpas'))}</strong>
                        {fc?._intake_paid_card4 ? ` ${t('ink.papier.pas', { cijfers: fc._intake_paid_card4 })}` : ""} —
                        {" "}{uitPapier === "kas"
                          ? t('ink.papier.kas')
                          : t('ink.papier.bank')}
                        {" "}{t('ink.papier.kloptNiet')}
                      </span>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                    {/* The paper's reading first, so the confirming tap is the nearest one. */}
                    {uitPapier === "kas"
                      ? [knop("kas", "💶 Contant"), knop("bank", "🏛️ Bank")]
                      : [knop("bank", "🏛️ Bank"), knop("kas", "💶 Contant")]}
                  </div>
                </>
              );
            })()}

            {/* Back to the review step */}
            <button
              onClick={() => setPayStep(false)}
              disabled={submitting}
              style={{
                width: "100%", padding: "14px", borderRadius: 14,
                background: "transparent", color: "#5f6368", border: "none",
                fontWeight: 600, fontSize: 15, cursor: "pointer",
              }}
            >
              ‹ Terug
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Simple confirm dialog (for Negeer) ────────────────────────────────────────

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmColor,
  onConfirm,
  onCancel,
  choices,
  choiceValue,
  onChoice,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor: string;
  onConfirm: () => void;
  onCancel: () => void;
  // [NEGEER-REDEN] Optioneel keuzelijstje boven de knoppen. Optioneel gehouden zodat elke
  // bestaande aanroep van deze dialoog onveranderd blijft werken.
  choices?: { value: string; label: string; hint: string }[];
  choiceValue?: string | null;
  onChoice?: (value: string | null) => void;
}) {
  const t = translator(useLocale())
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 2000, padding: 24,
      }}
      onClick={onCancel}
    >
      <div className="sheet-scroll"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 18, padding: "24px 20px",
          width: "100%", maxWidth: 320, textAlign: "center",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 17, color: "#202124", marginBottom: 8 }}>
          {title}
        </div>
        <div style={{ fontSize: 14, color: "#5f6368", marginBottom: choices?.length ? 14 : 20, lineHeight: 1.5 }}>
          {message}
        </div>
        {/* [NEGEER-REDEN] Vrijwillig. Nog een keer klikken op een gekozen reden zet hem weer uit,
            zodat "ik weet het niet" een echte uitkomst is en niet iets wat je moet omzeilen. */}
        {choices && choices.length > 0 && (
          <div style={{ textAlign: "start", marginBottom: 18 }}>
            <div style={{ fontSize: 12, color: "#80868b", marginBottom: 8, fontWeight: 600 }}>
              {t('ink.negeren.waarom')}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {choices.map((c) => {
                const active = choiceValue === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => onChoice?.(active ? null : c.value)}
                    style={{
                      display: "flex", alignItems: "baseline", gap: 8, width: "100%",
                      padding: "9px 11px", borderRadius: 10, cursor: "pointer", textAlign: "start",
                      background: active ? "#e8f0fe" : "#f8f9fa",
                      border: `1px solid ${active ? "#1a73e8" : "#e8eaed"}`,
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700, color: active ? "#1a73e8" : "#3c4043", whiteSpace: "nowrap" }}>
                      {c.label}
                    </span>
                    <span style={{ fontSize: 12, color: "#80868b", lineHeight: 1.35 }}>
                      {c.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <button
          onClick={onConfirm}
          style={{
            width: "100%", padding: "14px", borderRadius: 12,
            background: confirmColor, color: "#fff", border: "none",
            fontWeight: 700, fontSize: 15, cursor: "pointer", marginBottom: 8,
          }}
        >
          {confirmLabel}
        </button>
        <button
          onClick={onCancel}
          style={{
            width: "100%", padding: "12px", borderRadius: 12,
            background: "transparent", color: "#5f6368", border: "none",
            fontWeight: 600, fontSize: 15, cursor: "pointer",
          }}
        >
          {t('ink.annuleren')}
        </button>
      </div>
    </div>
  );
}

// ── Invoice card — collapsible accordion ──────────────────────────────────────

// Exported for the render gate only (tests/render/). The list renders every card COLLAPSED, and
// everything worth asserting — the reasons block, the supplier memory — lives in the expanded body,
// which a static render never produces because opening a card is a click. Exporting the card is the
// difference between "the queue renders" and "the warning the queue exists for renders".
export function InvoiceCard({
  invoice,
  mode,
  expanded,
  onToggle,
  onConfirmPaid,
  // [QUEUE-EDIT-UX] opens the same verify modal with edit fields active
  onEdit,
  onIgnore,
  onRestore,
  selectMode = false,
  selected = false,
  onSelect = () => {},
  // [INTAKE-FOCUS] deep-link target: element id for scrollIntoView + brief ring
  domId,
  highlighted = false,
  // [READING-MEMORY] What the owner has repeatedly corrected at THIS supplier, if anything.
  readingHint,
  // [LEVERANCIER-KIEZEN] Handed straight on to the document sheet, whose foot carries the second
  // door where a supplier is named. The queue's verify modal is the first; a picker at one of the
  // two would be a feature the owner cannot rely on.
  suppliers = [],
  suppliersUnavailable = false,
}: {
  invoice: IncomingInvoice;
  mode: Tab;
  expanded: boolean;
  onToggle: () => void;
  onConfirmPaid: () => void;
  // [QUEUE-EDIT-UX] card-level edit entry point (pending tab only)
  onEdit: () => void;
  onIgnore: () => void;
  onRestore: () => void;
  // [INTAKE-VERIFY-BULK] selection (pending bulk-verify)
  selectMode?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  // [INTAKE-FOCUS]
  domId?: string;
  highlighted?: boolean;
  // [READING-MEMORY] One sentence, or nothing. Never a number — see reading-memory.ts.
  readingHint?: string | null;
  // [LEVERANCIER-KIEZEN] The owner's suppliers, for the supplier form in the document sheet.
  suppliers?: SupplierChoice[];
  // [NO-SILENT-EMPTY] That read failed — a different sentence from an empty list.
  suppliersUnavailable?: boolean;
}) {
  // [WAAROM-WACHT] De taal apart, want één regel op deze kaart heeft hem zelf nodig: de zin die
  // zegt waarom dit document wacht komt uit een pure module en draagt zijn eigen richting mee.
  const taal = useLocale()
  const t = translator(taal)
  const dialog = useDialog();
  const toast = useToast();
  const router = useRouter();

  // [SUPERSEDE] The invoice this one was flagged against, when the flag names one we can act on
  // EXACTLY. `possible_duplicate_of` next to it is a display string that falls back to a vendor
  // name, so it can label the button but must never select the row — the id does that, server
  // side, from this same stored flag. Absent on rows imported before the id was written: the
  // warning still shows, only the shortcut is missing, and that is the honest state of affairs.
  const supersedeTarget = (() => {
    // [SUPERSEDE] pending AND confirmed. A corrected re-issue the owner already verified is
    // still 'received', which refuseSupersede permits, so the shortcut must not vanish just
    // because the row moved one tab over — that was the difference between one tap and a trip
    // to another screen. Only the Genegeerd tab is excluded: an archived row answers nothing.
    if (mode === "ignored" || !invoice.health.flags.possibleDuplicate) return null;
    // [VERVANG-OVERAL] The flag itself is read by one shared rule, because the pay screen now asks
    // the same question of the same rows. Whether to OFFER the shortcut stays here — that is the
    // tab logic, which belongs to this screen and to no other.
    // [TAAL] Only the invoice NUMBER is data; every sentence that mentions the other invoice has
    // its own with/without-number variant in the catalogue (a noun is not a parameter).
    return supersedeTargetOf(invoice.field_confidence);
  })();

  // [MULTI-INVOICE] "Nee, dit is één factuur" — the owner's answer to a suspicion.
  //
  // The flag says either "this file looks like it holds several invoices" or "we could not check
  // whether it does" (a scan with no text layer). Both are guesses about what is NOT in the books,
  // both hold the invoice out of auto-booking, and neither can be settled by anyone but the person
  // holding the paper. Without a way to say no, the badge stays on a perfectly ordinary invoice
  // forever — and this badge also carries a real arithmetic error and a changed IBAN, so a false
  // one here costs more than itself: it teaches the owner to stop reading the amber line.
  //
  // Only offered on the pending queue. On Genegeerd there is nothing to answer, and a confirmed
  // invoice has already been judged by a human — which is what the flag was asking for.
  const canDismissMultiInvoice = mode === "pending" && invoice.health.flags.multipleInvoices;
  const [dismissingMulti, setDismissingMulti] = useState(false);
  const handleDismissMultiInvoice = async () => {
    if (dismissingMulti) return;
    const ok = await dialog.confirm({
      title: t('ink.multi.vraag'),
      message: t('ink.multi.uitleg'),
      confirmLabel: t('ink.multi.bevestig'),
    });
    if (!ok) return;
    setDismissingMulti(true);
    try {
      const res = await fetch(`/api/invoice/${invoice.id}/multi-invoice`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        await dialog.alert({
          title: t('ink.nietGelukt'),
          message: failureText(res.status, data, t('ink.multi.foutWeghalen')),
        });
        return;
      }
      toast(t('ink.multi.genoteerd'));
      router.refresh(); // the flag is answered; the queue re-renders without it
    } catch {
      await dialog.alert({
        title: t('inkoop.geenVerbinding'),
        message: t('ink.multi.foutVerbinding'),
      });
    } finally {
      setDismissingMulti(false);
    }
  };

  const [superseding, setSuperseding] = useState(false);
  const handleSupersede = async () => {
    if (superseding || !supersedeTarget) return;
    // Ask BEFORE anything happens, and describe the consequence rather than the action: what
    // leaves the books, and that it comes back with one tap. The server decides for real — this
    // dialog is the owner's informed yes, never the permission.
    const ok = await dialog.confirm({
      title: supersedeTarget.number
        ? t('ink.vervang.vraagMetNr', { nr: supersedeTarget.number })
        : t('ink.vervang.vraagZonderNr'),
      message: supersedeTarget.number
        ? t('ink.vervang.uitlegMetNr', { nr: supersedeTarget.number })
        : t('ink.vervang.uitlegZonderNr'),
      confirmLabel: t('ink.vervang.bevestig'),
    });
    if (!ok) return;
    setSuperseding(true);
    try {
      const res = await fetch(`/api/invoice/${invoice.id}/supersede`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The server asked the same questions of fresher data — show ITS answer, not ours. This
        // is where "the old one is already paid" lands, with the exit named.
        await dialog.alert({
          title: t('ink.vervang.kanNiet'),
          message: failureText(res.status, data, t('ink.vervang.mislukt')),
        });
        return;
      }
      toast(
        data?.archivedNumber
          ? t('ink.vervang.genegeerdMetNr', { nr: data.archivedNumber })
          : t('ink.vervang.genegeerdZonderNr'),
      );
      router.refresh(); // the flag is answered; the queue re-renders without it
    } catch {
      await dialog.alert({
        title: t('inkoop.geenVerbinding'),
        message: t('ink.vervang.foutVerbinding'),
      });
    } finally {
      setSuperseding(false);
    }
  };

  // [SUPERSEDE] The OTHER answer: "no, these really are two invoices." Confirming the invoice is
  // deliberately NOT read as this answer — that tap says the amounts are right, not that two
  // documents were compared — so the question needs its own way to be closed, or it would follow
  // the invoice around forever and reappear if it were ever restored to the queue.
  const handleDismissDuplicate = async () => {
    if (superseding || !supersedeTarget) return;
    setSuperseding(true);
    try {
      const res = await fetch(`/api/invoice/${invoice.id}/supersede`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        await dialog.alert({
          title: t('ink.nietGelukt'),
          message: failureText(res.status, data, t('ink.dubbel.foutWeghalen')),
        });
        return;
      }
      toast(t('ink.dubbel.genoteerd'));
      router.refresh();
    } catch {
      await dialog.alert({
        title: t('inkoop.geenVerbinding'),
        message: t('ink.dubbel.foutVerbinding'),
      });
    } finally {
      setSuperseding(false);
    }
  };

  // [REIMPORT] Re-read this invoice's stored PDF with the current extractor.
  // [REREAD-CONFIRMED] …and no longer only on a FLAGGED item. The offer below covers the clean
  // ones too, because a clean-looking invoice is exactly where a misread amount hides: the amber
  // block that used to hold the only button never appears on it.
  const [reimporting, setReimporting] = useState(false);
  // The same predicate the server re-checks, so the button never opens on a refusal.
  const reread = reimportDecision(invoice);
  const rereadOk = reread.allowed;
  // [TAAL] The sentence above the button, as a key the screen says in the owner's language.
  const rereadKey = reimportPromptKey(reread);
  // Whether the amber block above is already showing its own copy of this button.
  const hasHealthWarning =
    invoice.health.level === "needs-review" && invoice.health.reasons.length > 0;
  const handleReimport = async () => {
    if (reimporting) return;
    setReimporting(true);
    try {
      const res = await fetch(`/api/email/reimport/${invoice.id}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        router.refresh(); // pick up the refreshed amounts + health
        return;
      }
      if (data.notInvoice) {
        // [HERLEES-ARCHIVEER] main's newer behaviour, kept whole: the server now
        // archives such a document itself with reason "Geen factuur", so the
        // honest message is "it has been put away, and this is how you get it
        // back" — not "sort it out yourself". If archiving failed (money is
        // already booked against it, say), we say that instead.
        // Only the DELIVERY changed here: the app's own dialog rather than a
        // browser box, and router.refresh() rather than throwing the whole
        // document away. See docs/MOTION_SYSTEM.md.
        if (data.archived) {
          await dialog.alert({
            title: t('ink.herlees.geenFactuur'),
            message:
              t('ink.herlees.geenGegevens') +
              (data.reason ? ` (${data.reason})` : "") +
              ". " + t('ink.herlees.naarGenegeerd'),
          });
          router.refresh(); // de kaart hoort nu bij Genegeerd, niet meer in de wachtrij
          return;
        }
        await dialog.alert({
          title: t('ink.herlees.geenFactuur'),
          message:
            t('ink.herlees.geenGegevens') +
            (data.reason ? ` (${data.reason})` : "") +
            ". " +
            (failureText(res.status, data, t('ink.herlees.nietGewijzigd'))),
        });
      } else {
        toast(failureText(res.status, data, t('ink.herlees.mislukt')), { tone: "error" });
      }
    } catch {
      toast(t('ink.herlees.mislukt'), { tone: "error" });
    } finally {
      setReimporting(false);
    }
  };

  // [DOC-INLINE] Open the document INSIDE the app, with our reading and the checks beside it.
  //
  // This is the SAME window.open the pay screen had, and this is the more important of the two
  // places: the pay screen is where an invoice is settled, but THIS is where it is put into the
  // books. The owner standing here is deciding whether to confirm — which is precisely the moment
  // "what did we check, and what could we not check" is worth anything.
  //
  // The fetch moved into the sheet, so this is a state change and nothing else.
  const [showDoc, setShowDoc] = useState(false);

  return (
    <div
      id={domId}
      // [LIST-PAINT] Off-screen cards may skip style/layout/paint — see globals.css. The pending
      // queue is read with fetchAllRows and no cap on purpose ([QUEUE-COMPLETE]), so a mailbox
      // backfill puts hundreds of cards on this screen at once. The card stays in the DOM, so the
      // deep-link focus below (id + scrollMarginTop) still finds it.
      className="inv-card"
      style={{
        background: "#fff", borderRadius: 16, marginBottom: 12,
        overflow: "hidden",
        // [INTAKE-FOCUS] brief ring when deep-linked from the upload results
        // modal; scrollMarginTop keeps the card clear of the sticky header.
        boxShadow: highlighted
          ? "0 1px 4px rgba(0,0,0,0.08), 0 0 0 3px rgba(26,115,232,0.35)"
          : "0 1px 4px rgba(0,0,0,0.08)",
        transition: "box-shadow 0.5s ease",
        scrollMarginTop: 96,
      }}
    >
      {/* [DOC-INLINE] The paper, our reading of it, and the seven checks — see the component's
          header. Rendered from the card so it carries THIS invoice; the sheet fetches its own
          signed url and closes over nothing. */}
      {showDoc && (
        <InvoiceDocumentSheet
          suppliers={suppliers}
          suppliersUnavailable={suppliersUnavailable}
          invoice={{
            id: invoice.id,
            client_name: invoice.client_name,
            invoice_number: invoice.invoice_number,
            invoice_date: invoice.invoice_date,
            invoice_type: invoice.invoice_type,
            total_ex_btw: invoice.total_ex_btw,
            btw_amount: invoice.btw_amount,
            total_inc_btw: invoice.total_inc_btw,
            vendor_iban: invoice.vendor_iban ?? null,
            field_confidence: invoice.field_confidence as never,
            // [CHECKLIST] The queue holds no per-supplier number history, and passing none is the
            // SAFE direction rather than a shortcut: looksLikeCreditnota needs demonstrable
            // contrast between two kinds of number from one supplier, so fewer numbers can only
            // make the credit-note signal quieter — never make it fire on an invoice it should not.
            vendorNumbers: [],
          }}
          onClose={() => setShowDoc(false)}
          // The queue's own correction door is the verify modal, which is what onEdit opens.
          onCorrect={() => { setShowDoc(false); onEdit(); }}
          // [BETER-EXEMPLAAR] Bewust niet hier. In de controlewachtrij staan de bedragen nog niet
          // vast, en dan is "opnieuw inlezen" het juiste antwoord op een slechte foto: dat LEEST
          // het nieuwe papier. Vervangen leest met opzet niets, wat pas veilig én nuttig is als de
          // cijfers al bevestigd zijn — en dat is de betaalpagina.
          onReplaceFile={null}
        />
      )}

      {/* Header — always visible, tappable */}
      <button
        className="inv-row"
        onClick={onRowTap(selectMode ? onSelect : onToggle)}
        // [ROW-LAYOUT] display/align/gap live in the .inv-row class (globals.css) so the
        // stack-on-mobile media query can override them; the flex:1 main pushes the side
        // cluster right, so justify-content:space-between is no longer needed here.
        style={{
          width: "100%", padding: "16px", border: "none",
          background: "transparent", cursor: "pointer", textAlign: "start",
        }}
      >
        {/* [INTAKE-VERIFY-BULK] selection checkbox — only in pending select mode */}
        {selectMode && (
          <span
            style={{
              flexShrink: 0, width: 22, height: 22, borderRadius: 11,
              border: `2px solid ${selected ? "#34a853" : "#dadce0"}`,
              background: selected ? "#34a853" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 13, fontWeight: 700,
            }}
          >
            {selected ? "✓" : ""}
          </span>
        )}
        <div className="inv-row-main">
          <div
            style={{
              fontWeight: 700, fontSize: 16, color: "#202124", marginBottom: 3,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}
          >
            {invoice.client_name || t('ink.onbekendeAfzender')}
          </div>
          {/* [INCOMING-CHROME] The date and every badge on ONE line, in the app's
              own overflow strip (.inv-strip in globals.css: no wrap, scrolls
              sideways instead of stacking). Each badge used to claim a line of
              its own under the date, so a card was ~90px tall and a 37-invoice
              queue showed three at a time on a laptop. Same information, one
              row shorter — and on a narrow phone the strip slides rather than
              breaking the row apart, which is exactly what it exists for. */}
          <div className="inv-strip" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
            <span style={{ fontSize: 13, color: "#5f6368", whiteSpace: "nowrap" }}>
              {formatDate(invoice.invoice_date)}
            </span>
            {/* [BRIDGE-CREDITNOTA-SIGN] Creditnota badge — a credit note is a
                DIFFERENT financial animal (negative amounts by design), so the
                owner must see it at a glance. Independent of the health badge:
                a clean creditnota shows Creditnota + "ready", a broken one shows
                Creditnota + "Aandacht nodig". */}
            {invoice.invoice_type === "creditnota" && (
              <div
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 8,
                  background: "#fdecea", border: "1px solid #f5b5ae",
                }}
              >
                <span style={{ fontSize: 12, color: "#b3261e", fontWeight: 600 }}>
                  {t('ink.creditnota')}
                </span>
              </div>
            )}
            {/* [AANSLAG] A Belastingdienst letter is a payable and not a cost; the badge names the
                tax so the owner sees at a glance where the money will book. Keys are literal
                (TAX_KIND_LABEL) so the [TAAL] gate can see each one rendered. */}
            {taxKindLabel(invoice) && (
              <div
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 8,
                  background: "#e8f0fe", border: "1px solid #aecbfa",
                }}
              >
                <span style={{ fontSize: 12, color: "#174ea6", fontWeight: 600 }}>
                  {t(taxKindLabel(invoice) as never)}
                </span>
              </div>
            )}
            {/* [NEGEER-REDEN] Op de Genegeerd-lijst: waarom staat hij hier? Neutraal grijs — dit is
                een notitie, geen waarschuwing. Ontbreekt hij (oude rij, of de vraag overgeslagen),
                dan staat er niets: liever geen label dan een verzonnen label. */}
            {mode === "ignored" && archiveReasonLabel(invoice.archive_reason) && (
              <div
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 8,
                  background: "#f1f3f4", border: "1px solid #e0e3e6",
                }}
              >
                <span style={{ fontSize: 12, color: "#5f6368", fontWeight: 600 }}>
                  {archiveReasonLabel(invoice.archive_reason)}
                </span>
              </div>
            )}
            {/* [SUPERSEDE] En WELKE factuur hem verving. "Dubbel" hierboven zegt de categorie; drie
                maanden later, bij de kwartaalafsluiting of als de leverancier belt, is de vraag niet
                "waarom staat dit hier" maar "waar is hij dan wél gebleven". Zonder dit antwoord moet
                de eigenaar dat uit zijn hoofd reconstrueren — precies het geheugenverlies dat het
                Genegeerd-tabblad ooit had. Ontbreekt het nummer (oude rij, of de migratie nog niet
                gedraaid), dan staat er niets: liever geen label dan een verzonnen label. */}
            {mode === "ignored" && (invoice.superseded_by_number ?? "").trim() && (
              <div
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 8,
                  background: "#f1f3f4", border: "1px solid #e0e3e6",
                }}
              >
                <span style={{ fontSize: 12, color: "#5f6368", fontWeight: 600 }}>
                  Vervangen door {invoice.superseded_by_number}
                </span>
              </div>
            )}
            {/* [IMPORT-MONITOR] Health badge — only in the pending queue. Flagged
                invoices get a calm-but-clear attention pill; clean invoices get a
                quiet "ready to confirm" hint (calm, never the alarming "review").
                The ignored tab shows nothing here — it must not nag. */}
            {mode === "pending" && (
              /* [IBAN-WISSEL] Een gewisseld rekeningnummer krijgt de ROOD-badge, niet de amberen
                 "Aandacht nodig". Reden: bij factuurfraude klopt al het andere — bedrag, nummer,
                 btw, datum — dus de gewone amberen pil zou dit laten lezen als "de AI twijfelde
                 ergens over", terwijl dit het enige signaal is dat over GELD gaat. Eigen kleur,
                 eigen woorden, en de reden eronder noemt beide nummers. */
              invoice.health.flags.ibanChanged ? (
                <div
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 8,
                    background: "#fce8e6", border: "1px solid #f5b5ae",
                  }}
                >
                  <span style={{ fontSize: 11 }}>🏦</span>
                  <span style={{ fontSize: 12, color: "#b3261e", fontWeight: 700 }}>
                    {t('ink.anderRekening')}
                  </span>
                </div>
              ) : invoice.health.level === "needs-review" ? (
                <div
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 8,
                    background: "#fff4e5", border: "1px solid #ffd9a8",
                  }}
                >
                  <span style={{ fontSize: 11 }}>⚠️</span>
                  <span style={{ fontSize: 12, color: "#9a5b00", fontWeight: 600 }}>
                    {t('ink.aandacht')}
                  </span>
                </div>
              ) : (
                <div
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                  }}
                >
                  <span style={{ fontSize: 11, color: M3.success }}>✓</span>
                  <span style={{ fontSize: 12, color: "#5f6368" }}>
                    {t('ink.klaarBevestigen')}
                  </span>
                </div>
              )
            )}
          </div>
        </div>

        {/* [ROW-LAYOUT] .inv-row-side-h (globals.css) keeps amount + badge + chevron in one
            horizontal cluster on a wide screen, and drops it to a full-width, right-aligned
            strip below 520px so the deelbetaling badge stops squeezing the afzender name. */}
        <div className="inv-row-side-h">
          <span style={{ fontWeight: 700, fontSize: 18, color: "#202124", whiteSpace: "nowrap" }}>
            {formatSignedAmount(invoice.total_inc_btw)}
          </span>
          {/* [PARTIAL-PAY] Deelbetaling badge — part received, rest still openstaand. Shown only
              while 0 < amount_paid < total (a fully-paid invoice leaves this list entirely). */}
          {(() => {
            const paid = Math.max(0, invoice.amount_paid ?? 0);
            const total = Math.abs(invoice.total_inc_btw ?? 0);
            if (!(paid > 0.005 && paid < total - 0.005)) return null;
            const remaining = Math.max(0, total - paid);
            return (
              <span
                title={t('ink.deelbetaling', { betaald: paid.toFixed(2), totaal: total.toFixed(2) })}
                style={{
                  fontSize: 11, fontWeight: 600, color: "#b06000", background: "#fef7e0",
                  border: "1px solid #fde293", borderRadius: 6, padding: "2px 6px", whiteSpace: "nowrap",
                }}
              >
                Deels betaald · € {remaining.toFixed(2)} open
              </span>
            );
          })()}
          <span
            style={{
              fontSize: 18, color: "#dadce0",
              transform: expanded ? "rotate(90deg)" : "none",
              transition: "transform 0.2s",
            }}
          >
            ›
          </span>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: "0 16px 16px" }}>
          <div style={{ height: 1, background: "#f8f9fa", marginBottom: 14 }} />

          {/* [READING-MEMORY] What this owner keeps having to fix at THIS supplier.

              Deliberately NOT gated on the health verdict, unlike the block below it. The whole
              reason this exists is the case where the reader is confident and wrong: Elegance
              Brands read cleanly in June and in July, and both times the owner had to repair the
              btw by hand. A hint that only appears when the app already suspects something would
              have stayed silent on exactly the invoices it is for.

              It names a FIELD, never an amount. A remembered number belongs to a different invoice;
              pre-filling it would be inventing money, which is the one thing this whole line
              refuses to do. So the app learns where to point the reviewer, not what the answer is.

              Pending only: on a confirmed or ignored card there is nothing left to check. */}
          {mode === "pending" && readingHint && (
            <div
              style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                padding: "12px 14px", marginBottom: 14,
                background: "#eef4ff", borderRadius: 12, border: "1px solid #cddcff",
              }}
            >
              <span style={{ fontSize: 15, lineHeight: 1.3 }}>🧠</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#274690", marginBottom: 4 }}>
                  {t('ink.vakerCorrigeert')}
                </div>
                <div style={{ fontSize: 12.5, color: "#274690", lineHeight: 1.5 }}>{readingHint}</div>
              </div>
            </div>
          )}

          {/* [WAAROM-WACHT] En de kaart die er goed uitziet en tóch wacht.
              
              De gemarkeerde factuur hierónder krijgt al een badge en een lijst redenen; die weet
              de eigenaar te lezen. Het gat zat bij de kaart met een groen "klaar om te bevestigen"
              die evengoed op een tik staat te wachten: daar stond niets, dus las de eigenaar een
              document dat goed gelezen wás nog een keer, vond niets, tikte bevestigen en leerde
              niets. Van de 590 documenten in één echte administratie waren er 350 zo'n tik waard.
              
              Alleen wanneer geen andere badge het al uitlegt — twee uitleggen van één vertraging
              is hoe een rustig scherm een zeurend scherm wordt. En alleen als de reden ook echt is
              vastgelegd: een rij van vóór deze meting draagt er geen, en dan staat er niets in
              plaats van een gok. */}
          {mode === "pending" && (() => {
            const uitleg = explainWaiting(
              waitingReasonOf(invoice.field_confidence),
              { alreadyExplained: invoice.health.flags.ibanChanged || invoice.health.level === "needs-review" },
              taal,
            );
            if (!uitleg) return null;
            // De eigen keuze krijgt een andere kleur dan een leesprobleem: het eerste is iets om
            // om te zetten, het tweede iets om na te kijken. Allebei kalm — er is niets mis.
            const keuze = uitleg.kind === "setting";
            return (
              <div
                dir={uitleg.dir}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "12px 14px", marginBottom: 14,
                  background: keuze ? "#eef4ff" : "#f1f3f4", borderRadius: 12,
                  border: `1px solid ${keuze ? "#cddcff" : "#e0e3e6"}`,
                  textAlign: "start",
                }}
              >
                <span style={{ fontSize: 15, lineHeight: 1.3 }}>{keuze ? "⚙️" : "⏳"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: keuze ? "#274690" : "#3c4043", marginBottom: 4 }}>
                    {t('ink.waaromWacht')}
                  </div>
                  <div style={{ fontSize: 12.5, color: keuze ? "#274690" : "#5f6368", lineHeight: 1.5 }}>
                    {uitleg.text}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* [IMPORT-MONITOR] Part 3 — the WHY. For a flagged invoice, show the
              plain-language reason(s) the system is unsure, sourced from the
              read-time health verdict (stored _safecore reason and/or the AI's
              low-confidence fields). Reassurance-shaped: "here's what to check",
              not a dense breakdown. Shown only in the pending queue; clean
              invoices show nothing here (no demand on the tired owner). */}
          {mode === "pending" &&
            invoice.health.level === "needs-review" &&
            invoice.health.reasons.length > 0 && (
              <div
                style={{
                  display: "flex", alignItems: "flex-start", gap: 8,
                  padding: "12px 14px", marginBottom: 14,
                  background: "#fff4e5", borderRadius: 12,
                  border: "1px solid #ffd9a8",
                }}
              >
                <span style={{ fontSize: 15, lineHeight: 1.3 }}>💡</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#9a5b00", marginBottom: 4 }}>
                    {t('ink.evenControleren')}
                  </div>
                  <div style={{ fontSize: 12.5, color: "#9a5b00", lineHeight: 1.5 }}>
                    {/* Capitalize the first reason; join the rest naturally. */}
                    {invoice.health.reasons
                      .map((r) => r.charAt(0).toUpperCase() + r.slice(1))
                      .join(" · ")}
                    .
                  </div>
                  {/* [REIMPORT] Self-heal: re-read the stored PDF with the current extractor.
                      Safe — the server only refreshes an invoice still in this queue and never
                      overwrites verified data. Falls back to manual Bewerken if it can't help. */}
                  <button
                    onClick={handleReimport}
                    disabled={reimporting}
                    style={{
                      marginTop: 10, padding: "7px 12px", borderRadius: 9,
                      background: reimporting ? "#f0d9b8" : "#fff", cursor: reimporting ? "default" : "pointer",
                      border: "1px solid #e0a94f", color: "#9a5b00", fontWeight: 600, fontSize: 12.5,
                      display: "inline-flex", alignItems: "center", gap: 6,
                    }}
                  >
                    <span style={{ fontSize: 13 }}>↻</span>
                    {reimporting ? t('ink.opnieuwBezig') : t('ink.herleesKnop')}
                  </button>
                  {/* [SUPERSEDE] "Deze vervangt factuur X" — the answer to the one flag on this
                      card that is not a reading problem. A supplier who invoices the wrong amount
                      and corrects it leaves TWO invoices in the books; the queue said so and then
                      left the owner to go to another screen, find the old one and remove it
                      there. Two screens for what is one answer. Shown only when the flag names an
                      invoice we can act on EXACTLY (an id, written at import time) — for a row
                      imported before that existed the warning still shows, just without the
                      shortcut, and removing the old one by hand still works. */}
                  {supersedeTarget && (
                    <button
                      onClick={handleSupersede}
                      disabled={superseding}
                      style={{
                        marginTop: 10, marginInlineStart: 8, padding: "7px 12px", borderRadius: 9,
                        background: superseding ? "#f0d9b8" : "#fff", cursor: superseding ? "default" : "pointer",
                        border: "1px solid #e0a94f", color: "#9a5b00", fontWeight: 600, fontSize: 12.5,
                        display: "inline-flex", alignItems: "center", gap: 6,
                      }}
                    >
                      <span style={{ fontSize: 13 }}>⇄</span>
                      {superseding
                        ? t('act.bezig')
                        : (supersedeTarget.number ? t('ink.vervang.knopMetNr', { nr: supersedeTarget.number }) : t('ink.vervang.knopZonderNr'))}
                    </button>
                  )}
                  {/* [SUPERSEDE] The second answer, so the question can be closed BOTH ways. Without
                      it the only way out was to replace something — and an owner whose two invoices
                      are genuinely different had nothing to tap, so the warning followed the invoice
                      for good. Confirming is not read as this answer: that tap means the amounts are
                      right, not that two documents were compared. */}
                  {supersedeTarget && (
                    <button
                      onClick={handleDismissDuplicate}
                      disabled={superseding}
                      style={{
                        marginTop: 10, marginInlineStart: 8, padding: "7px 12px", borderRadius: 9,
                        background: "transparent", cursor: superseding ? "default" : "pointer",
                        border: "1px solid transparent", color: "#9a5b00", fontWeight: 600, fontSize: 12.5,
                        display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "underline",
                      }}
                    >
                      {t('ink.neeAndere')}
                    </button>
                  )}
                </div>
                  {/* [MULTI-INVOICE] The answer to "does this file hold more than one invoice?".
                      It sits in the same row as the duplicate answers because it is the same kind
                      of thing: a suspicion only the person holding the paper can settle. Without
                      it the amber box had a reason the owner could read and nothing to do about
                      it — and this box also carries the arithmetic error and the changed IBAN, so
                      a warning that can never be answered teaches people to stop reading it. */}
                  {canDismissMultiInvoice && (
                    <button
                      onClick={handleDismissMultiInvoice}
                      disabled={dismissingMulti}
                      style={{
                        marginTop: 10, marginInlineStart: 8, padding: "7px 12px", borderRadius: 9,
                        background: dismissingMulti ? "#f1f3f4" : "#fff", cursor: dismissingMulti ? "default" : "pointer",
                        border: "1px solid #dadce0", color: "#3c4043", fontWeight: 600, fontSize: 12.5,
                        display: "inline-flex", alignItems: "center", gap: 6,
                      }}
                    >
                      <span style={{ fontSize: 13 }}>✓</span>
                      {dismissingMulti ? t('act.bezig') : t('ink.multi.nee')}
                    </button>
                  )}
              </div>
            )}

          {/* [SUPERSEDE] On the Bevestigd tab the "Even controleren" box above does not render — it
              is a queue concept — so a confirmed invoice that still carries a duplicate warning had
              nowhere to answer it. That is the common shape of this exact problem: the corrected
              re-issue gets verified first (its amounts are right, so it looks clean), and only then
              does the owner notice the old one is still in the books. Both answers belong here too,
              compact and without the queue's "check this" framing. */}
          {mode === "confirmed" && supersedeTarget && (
            <div style={{
              display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap",
              padding: "10px 12px", marginBottom: 14,
              background: "#fff4e5", borderRadius: 10, border: "1px solid #ffd9a8",
            }}>
              <div style={{ flex: 1, minWidth: 180, fontSize: 12.5, color: "#9a5b00", lineHeight: 1.5 }}>
                {supersedeTarget.number ? t('ink.dubbel.metNr', { nr: supersedeTarget.number }) : t('ink.dubbel.zonderNr')}
              </div>
              <button
                onClick={handleSupersede}
                disabled={superseding}
                style={{
                  padding: "6px 11px", borderRadius: 9, background: superseding ? "#f0d9b8" : "#fff",
                  cursor: superseding ? "default" : "pointer", border: "1px solid #e0a94f",
                  color: "#9a5b00", fontWeight: 600, fontSize: 12.5,
                }}
              >
                {superseding ? t('act.bezig') : (supersedeTarget.number ? t('ink.vervang.knopMetNr', { nr: supersedeTarget.number }) : t('ink.vervang.knopZonderNr'))}
              </button>
              <button
                onClick={handleDismissDuplicate}
                disabled={superseding}
                style={{
                  padding: "6px 11px", borderRadius: 9, background: "transparent",
                  cursor: superseding ? "default" : "pointer", border: "1px solid transparent",
                  color: "#9a5b00", fontWeight: 600, fontSize: 12.5, textDecoration: "underline",
                }}
              >
                {t('ink.neeAndere')}
              </button>
            </div>
          )}

          {/* Detail rows */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            <DetailRow label={t('ink.factuurnummer')} value={invoice.invoice_number || "—"} />
            <DetailRow label={t('ink.afzender')} value={invoice.client_email || "—"} />
            <DetailRow
              label={t('ink.bedragExcl')}
              value={formatSignedAmount(invoice.total_ex_btw)}
            />
            <DetailRow
              label="BTW"
              value={formatSignedAmount(invoice.btw_amount)}
            />
            <DetailRow
              label={t('ink.totaal')}
              value={formatSignedAmount(invoice.total_inc_btw)}
              bold
            />
            <DetailRow
              label={t('ink.bron')}
              value={invoice.source === "email" ? t('nieuw.bevestig.email') : t('ink.bron.upload')}
            />
          </div>

          {/* View PDF button */}
          {invoice.pdf_url && (
            <button
              onClick={() => setShowDoc(true)}
              style={{
                width: "100%", padding: "12px", borderRadius: 12,
                background: "#e8f0fe", border: "1.5px solid #1a73e8",
                color: "#1a73e8", fontWeight: 600, fontSize: 14,
                cursor: "pointer", marginBottom: 10,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              <span style={{ fontSize: 16 }}>📄</span>
              {t('ink.bekijkControles')}
            </button>
          )}

          {/* [REREAD-CONFIRMED] The offer, on EVERY queued invoice — not only the flagged ones.
              The button above lives inside the amber "Even controleren" block, so on an invoice
              the app considers fine it is not on the screen at all. That is precisely the invoice
              this exists for: Enka Horeca showed every check green over a btw that was € 0,46
              wrong, the owner was told to press "Opnieuw inlezen", and there was nothing to press.

              Same argument as [AMOUNT-CORRECTION] on the pay screen: the reader can be wrong
              without any gate noticing, and the owner is the one holding the paper. */}
          {mode === "pending" && !hasHealthWarning && rereadOk && (
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 12, color: "#5f6368", margin: "0 0 6px", lineHeight: 1.45 }}>
                {rereadKey && t(rereadKey)}
              </p>
              <button
                onClick={handleReimport}
                disabled={reimporting}
                style={{
                  padding: "7px 12px", borderRadius: 9,
                  background: "#fff", cursor: reimporting ? "default" : "pointer",
                  border: "1px solid #dadce0", color: "#1a73e8", fontWeight: 600, fontSize: 12.5,
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}
              >
                <span style={{ fontSize: 13 }}>↻</span>
                {reimporting ? t('ink.opnieuwBezig') : t('ink.herleesKnop')}
              </button>
            </div>
          )}

          {/* [BOEK-011] Folder location — link to Mijn Bestanden */}
          {invoice.folder_id && (
            <a
              href={`/dashboard/bestanden?folder=${invoice.folder_id}`}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 12px", borderRadius: 10, marginBottom: 10,
                background: "#f8f9fa", textDecoration: "none",
              }}
            >
              <span style={{ fontSize: 15 }}>📁</span>
              <span style={{ flex: 1, fontSize: 13, color: "#5f6368" }}>
                {t('ink.opgeslagenIn')}{" "}
                <span style={{ color: "#202124", fontWeight: 600 }}>
                  {invoice.folder_name || t('best.mijn')}
                </span>
              </span>
              <span style={{ fontSize: 15, color: "#dadce0" }}>›</span>
            </a>
          )}

          {/* Actions — depend on mode */}
          {mode === "confirmed" ? (
            /* [INCOMING-BEVESTIGD] Already out of the queue — read-only status, no verify action.
               'paid' = settled (green); 'received' = verified but still te betalen (blue). Full
               management (mark paid, edit, accountant handoff) lives on Crediteuren. */
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px",
                borderRadius: 980, fontSize: 13, fontWeight: 700,
                background: invoice.status === "paid" ? "#e6f4ea" : "#e8f0fe",
                color: invoice.status === "paid" ? "#137333" : "#1a56c4",
              }}>
                <span style={{ fontSize: 15 }}>{invoice.status === "paid" ? "✓" : "•"}</span>
                {invoice.status === "paid" ? t('status.paid') : t('ink.bevestigdTeBetalen')}
              </span>
              {/* [CIRKEL] Land ON this invoice, not on top of a 200-row list — manage's ?focus=
                  fetches an out-of-window row by id, so this cannot miss even for old paid rows. */}
              <a
                href={`/dashboard/incoming/manage?focus=${encodeURIComponent(invoice.id)}`}
                style={{ marginInlineStart: "auto", fontSize: 13, fontWeight: 600, color: "#1a73e8", textDecoration: "none" }}
              >
                {t('ink.beheren')} ›
              </a>
            </div>
          ) : mode === "pending" ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={onIgnore}
                style={{
                  flex: 1, padding: "13px 0", borderRadius: 12,
                  background: "#f8f9fa", border: "none", color: "#5f6368",
                  fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}
              >
                {t('ink.negeer')}
              </button>
              {/* [QUEUE-EDIT-UX] Direct edit entry — same verify modal, edit
                  fields already open. Saves the Verifiëren→Gegevens-aanpassen
                  detour when the owner already knows something needs fixing. */}
              <button
                onClick={onEdit}
                style={{
                  flex: 1, padding: "13px 0", borderRadius: 12,
                  background: "#eaf2ff", border: "none", color: "#1a73e8",
                  fontWeight: 600, fontSize: 14, cursor: "pointer",
                }}
              >
                {t('ink.bewerken')}
              </button>
              <button
                onClick={onConfirmPaid}
                style={{
                  flex: 2, padding: "13px 0", borderRadius: 12,
                  background: "#34a853", border: "none", color: "#fff",
                  fontWeight: 700, fontSize: 14, cursor: "pointer",
                }}
              >
                {t('ink.verifieren')}
              </button>
            </div>
          ) : (
            <button
              onClick={onRestore}
              style={{
                width: "100%", padding: "13px 0", borderRadius: 12,
                background: "#e8f0fe", border: "1.5px solid #1a73e8",
                color: "#1a73e8", fontWeight: 600, fontSize: 14, cursor: "pointer",
              }}
            >
              {t('ink.terugzetten')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ fontSize: 13, color: "#5f6368" }}>{label}</span>
      <span
        style={{
          fontSize: 13, color: "#202124",
          fontWeight: bold ? 700 : 500,
          textAlign: "end", overflow: "hidden", textOverflow: "ellipsis",
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ── Manual upload ─────────────────────────────────────────────────────────────

// [INTAKE-FEEDBACK] Per-file outcome shown in the results modal.
type IntakeResult = {
  name: string;
  // [AUTO-ADVANCE-HONESTY] "auto" is a DIFFERENT outcome from "invoice", not a nicer word for
  // it: /api/intake books a clean, confident invoice straight to 'received' (auto_verified),
  // so it is NOT in this verify queue — it is with the Inkoopfacturen. Reporting it as
  // "invoice" pointed the owner at a card that is not here. "statement" / "turnover" /
  // "ledger" are the destinations the route gained since; without them each fell through to
  // the "invoice" default below and was announced as an invoice awaiting a tap.
  status: "auto" | "invoice" | "statement" | "reminder" | "turnover" | "ledger" | "document" | "bank" | "duplicate" | "error" | "skipped";
  message: string;
  // [BATCH-HERKANSING] The file itself, kept on the row.
  //
  // Without it a failure is final: the outcome said "probeer het zo opnieuw" and there was nothing
  // to press, so the owner had to go back to the file manager and find file 12 of 20 again. On a
  // month of supplier invoices that is where a document quietly does not get added — and a missing
  // purchase invoice is btw that is never reclaimed.
  //
  // /dashboard/upload has had this from the start ([UPLOAD-ERRORS], retryAllFailed). This screen
  // uploads to the SAME route and threw the file away the moment the request came back.
  file?: File;
  // From describeUploadFailure — all three were already computed here and dropped on the floor.
  // A 402 (monthly allowance spent) and a 413 (too big) return the SAME answer on a second
  // attempt, so those rows must not offer one; a 429 is only "too fast" and must.
  rateLimited?: boolean;
  fairUse?: boolean;
  noRetry?: boolean;
  // A 409 the server says may be overridden — the semantic duplicate gate, not the byte-hash one.
  // Without this the owner meets a wall on a file the server itself calls overridable.
  canForce?: boolean;
  retrying?: boolean;
  // present for document / duplicate → deep-link + focus in Mijn bestanden
  link?: { folderId: string | null; focusId: string };
  // [INTAKE-FOCUS] present for invoice/receipt → "Naar controle →" deep-links to
  // this card in the verify queue (?focus=). The API always returned invoice_id;
  // the modal just never used it — the owner was told "controleer en bevestig"
  // without a path to the invoice.
  invoiceId?: string;
};

// [TAAL] The labels live in the catalogue; this table keeps only the keys plus the visuals,
// rendered through the component's translator.
const RESULT_META = {
  auto:      { icon: "✓",  color: M3.success, labelKey: "ink.result.auto" },
  invoice:   { icon: "✓",  color: M3.success, labelKey: "ink.result.invoice" },
  statement: { icon: "🧾", color: "#9a5b00",  labelKey: "ink.result.statement" },
  // [HERINNERING-NOOIT] A payment reminder: kept, linked to its invoice, never booked.
  reminder:  { icon: "🔔", color: "#9a5b00",  labelKey: "ink.result.reminder" },
  turnover:  { icon: "🛒", color: M3.success, labelKey: "ink.result.turnover" },
  ledger:    { icon: "🔗", color: "#7B1FA2",  labelKey: "ink.result.ledger" },
  document:  { icon: "📁", color: "#1a73e8",  labelKey: "ink.result.document" },
  bank:      { icon: "🏦", color: "#1a73e8",  labelKey: "ink.result.bank" },
  duplicate: { icon: "ℹ️", color: "#5f6368",  labelKey: "ink.result.duplicate" },
  error:     { icon: "⚠️", color: "#b3261e",  labelKey: "ink.result.error" },
  // [BATCH-HERKANSING] Over the per-drop cap. NOT an error and NOT a success: nothing was sent,
  // nothing was lost, and the file is named so the owner knows exactly which ones to drop again.
  skipped:   { icon: "⏸️", color: "#9a5b00",  labelKey: "ink.result.skipped" },
} as const satisfies Record<IntakeResult["status"], { icon: string; color: string; labelKey: string }>;

function ManualUpload({ onUploaded }: { onUploaded: () => void }) {
  const t = translator(useLocale())
  const toast = useToast();
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // [SMART-INTAKE-B] separate camera input (capture) alongside the file input
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // [INTAKE-MULTI] batch progress
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  // [INTAKE-FEEDBACK] results modal — tells the user WHERE each file landed
  const [results, setResults] = useState<IntakeResult[]>([]);
  const [showResults, setShowResults] = useState(false);

  // [MULTI-PAGE] "Meerdere pagina's = één factuur" flow. The owner explicitly gathers the
  // pages of ONE invoice (photograph or pick), we combine them into a single multi-page PDF,
  // and send it as ONE file — so a 2/3-page invoice never becomes 2/3 separate invoices.
  const [mpOpen, setMpOpen] = useState(false);
  // [MULTI-PAGE] A single invoice with more pages than this is unusual — cap so the combined
  // PDF and the AI read stay sane. Well above any real paper invoice.
  const MAX_PAGES = 20;
  // [PAGINA-VOLGORDE] The tray — pages, thumbnails, order and what the last add did — is one
  // shared piece of state, identical to the one on /dashboard/upload.
  const tray = usePageTray(MAX_PAGES);
  const [combining, setCombining] = useState(false);
  const mpCameraRef = useRef<HTMLInputElement>(null);
  const mpFileRef = useRef<HTMLInputElement>(null);

  // [INTAKE-MULTI] Max files per batch — protects the server / AI from a huge drop.
  const MAX_BATCH = 20;

  // [INTAKE-KEEP-ALL] Accept every common invoice/document format. PDFs and images go to the
  // extractor; the rest (XML/UBL e-invoices, Office docs, CSV, e-mail files, bank exports) are
  // kept in bestanden by the server so nothing is ever lost. Only clearly non-document binaries
  // are refused here to avoid a pointless upload.
  const isOkType = (file: File) =>
    file.type === "application/pdf" ||
    file.type.startsWith("image/") ||
    /\.(pdf|xml|ubl|mt940|sta|camt|053|txt|csv|docx?|xlsx?|ods|odt|html?|eml|p7m)$/i.test(file.name);

  // [INTAKE-FEEDBACK] Upload one file via /api/intake and map the response to a
  // structured outcome (never throws) — the modal renders the destination.
  const uploadOne = async (file: File, force = false): Promise<IntakeResult> => {
    try {
      // [UPLOAD-PLAFOND] Fit an image OR a PDF to the upload budget, and answer a platform 413 by
      // squeezing harder rather than failing. This path normalized images only, so a scanned
      // supplier PDF over the budget was refused by the platform with no sentence at all.
      const { response: res } = await sendWithFit(file, (f) => {
        const formData = new FormData();
        formData.append("file", f);
        // [BATCH-HERKANSING] "Toch toevoegen" on a semantic duplicate — the same override
        // /dashboard/upload sends. Never set by itself: only when the owner presses the button
        // the server's own `canForce` put there.
        if (force) formData.append("force", "true");
        return fetch("/api/intake", { method: "POST", body: formData });
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));

      if (res.ok) {
        const dest = (data as { destination?: string }).destination;
        const message = (data as { message?: string }).message || t('ink.upload.toegevoegdKort');
        if (dest === "document") {
          const docId = (data as { document_id?: string }).document_id;
          return {
            name: file.name, status: "document", message,
            link: docId ? { folderId: (data as { folder_id?: string }).folder_id ?? null, focusId: docId } : undefined,
          };
        }
        if (dest === "bank") {
          return { name: file.name, status: "bank", message };
        }
        // [STATEMENT-RECONCILE] A supplier statement is a completeness CHECK, not a booking:
        // nothing enters the books, so it must not be announced as an added invoice.
        // [HERINNERING-NOOIT] Same shape for a payment reminder: filed, linked to its invoice
        // when found, never booked — the message says which of the three happened.
        if (dest === "statement" || dest === "reminder") {
          const docId = (data as { document_id?: string }).document_id;
          return {
            name: file.name, status: dest, message,
            link: docId ? { folderId: (data as { folder_id?: string }).folder_id ?? null, focusId: docId } : undefined,
          };
        }
        if (dest === "turnover" || dest === "ledger") {
          return { name: file.name, status: dest, message };
        }
        // [AUTO-ADVANCE-HONESTY] A clean, confident invoice is booked straight to 'received' and
        // is therefore NOT in this queue — sending the owner to "controle" showed them a list
        // without the card they were promised. Same invoice_id, a truthful destination.
        // [INTAKE-FOCUS] keep invoice_id so the row can deep-link to the card either way.
        const autoVerified = (data as { auto_verified?: boolean }).auto_verified === true;
        return {
          name: file.name, status: autoVerified ? "auto" : "invoice", message,
          invoiceId: (data as { invoice_id?: string }).invoice_id,
        };
      }

      // Not ok — duplicate is informative, not a failure.
      if ((data as { duplicate?: boolean }).duplicate) {
        const existing = (data as { existing?: { id: string; folder_id: string | null } }).existing;
        // [MELDING-WEG] [TAAL] The place is structured; the sentence is the catalogue's — the same
        // module the upload hub reads, so the two doors say it the same way.
        const where = duplicateWhere(data);
        return {
          name: file.name, status: "duplicate", file,
          message: where ? t(where.key, where.params) : failureText(res.status, data as { error?: unknown }, t('ink.result.duplicate')),
          link: existing?.id ? { folderId: existing.folder_id ?? null, focusId: existing.id } : undefined,
          // The server says whether this one may be overridden. The byte-hash gate deliberately
          // may not; the semantic one may, and this screen used to offer neither.
          canForce: (data as { canForce?: boolean }).canForce === true && !force,
        };
      }
      // [UPLOAD-ERRORS] The same translator /dashboard/upload and the Toevoegen sheet use. This
      // surface uploads to the SAME /api/intake and was the one place the shared fix did not
      // reach: `data.error || "Upload mislukt"` is right exactly once, for our own 5xx. A 402
      // (monthly read allowance spent) read as a breakage although the server sends the reason and
      // the way out; a 413 or 504 comes from the PLATFORM with an HTML body, so `data.error` does
      // not exist there at all and a perfectly fine file was reported as failed.
      // [UPLOAD-ERRORS] The translator returns four things and this screen read one of them. The
      // other three decide whether a second attempt is worth offering at all: a 402 and a 413
      // return the same answer forever, a 429 does not.
      const failure = describeUploadFailure(res.status, (data as { error?: string }).error);
      return {
        name: file.name,
        status: "error",
        file,
        message: failure.message,
        rateLimited: failure.rateLimited,
        fairUse: failure.fairUse,
        noRetry: failure.noRetry,
      };
    } catch {
      // A connection that dropped is the most retryable failure there is — keep the file.
      return { name: file.name, status: "error", file, message: t('ink.upload.mislukt') };
    }
  };

  // [INTAKE-FEEDBACK] Sequential batch — collect every outcome, then show the
  // results modal. No silent reload: the user sees where each file went, and
  // reloads (to refresh the queue) only when they tap "Klaar".
  const handleFiles = async (fileList: FileList | null) => {
    if (uploading || !fileList || fileList.length === 0) return;

    const all = Array.from(fileList);

    const accepted: File[] = [];
    const collected: IntakeResult[] = [];
    for (const f of all) {
      if (isOkType(f)) accepted.push(f);
      else collected.push({ name: f.name, status: "error", noRetry: true, message: t('ink.upload.nietOndersteund') });
    }

    // [BATCH-HERKANSING] Over the cap, the batch is SPLIT — it used to be refused whole.
    //
    // Dropping 25 files got a toast and nothing else: not one of the 25 was sent, and the owner
    // was left to work out which twenty to drop first. The cap exists to protect the reader from a
    // huge burst, and taking the first twenty does that just as well. The rest get a row of their
    // own, by name, saying they were not sent — so the second drop is obvious instead of a
    // reconstruction. Nothing is lost either way; the difference is whether the owner can see it.
    const overflow = accepted.splice(MAX_BATCH);
    for (const f of overflow) {
      collected.push({ name: f.name, status: "skipped", file: f, message: t('ink.result.buitenBatch', { max: MAX_BATCH }) });
    }

    if (accepted.length === 0) {
      setResults(collected);
      setShowResults(true);
      return;
    }

    setUploading(true);
    setTotal(accepted.length);
    for (let i = 0; i < accepted.length; i++) {
      setCurrent(i + 1);
      collected.push(await uploadOne(accepted[i]));
    }
    setUploading(false);
    setCurrent(0);
    setTotal(0);

    // [BANK-AUTO-RUN] If any file was a bank statement, close the circle right here: the
    // near-certain payments (reference + amount to the cent) get auto-booked so a matching
    // invoice moves to 'paid' immediately — the owner never has to walk over to /bank for it.
    // Best-effort; a matched count is surfaced on the bank line's result row.
    if (collected.some((r) => r.status === "bank")) {
      const booked = await triggerBankAutoConfirm();
      if (booked > 0) {
        for (const r of collected) {
          if (r.status === "bank") {
            r.message = `${r.message} — ${booked === 1 ? t('ink.gekoppeld.autoEen') : t('ink.gekoppeld.autoMeer', { n: booked })}`;
          }
        }
      }
    }

    onUploaded();
    setResults(collected);
    setShowResults(true);
  };

  // ── [MULTI-PAGE] "Meerdere pagina's = één factuur" ─────────────────────────────
  // Collect the pages (photograph or pick — images only), then combine them into ONE PDF and
  // send it through the SAME /api/intake as a single file. Never guesses: the owner opted in.
  const addMpPages = (fl: FileList | null) => {
    if (!fl || fl.length === 0) return;
    const imgs = Array.from(fl).filter(
      (f) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name),
    );
    if (imgs.length === 0) {
      toast(t('ink.mp.alleenFotos'), { tone: "error" });
      return;
    }
    // [PAGINA-VOLGORDE] Order, re-picks and overflow are one decision, taken in page-order.ts and
    // REPORTED by the tray. This used to append the browser's own order and trim the surplus
    // inside a state updater — see the module header for what that cost.
    tray.add(imgs);
  };
  const cancelMultiPage = () => { setMpOpen(false); tray.reset(); };
  const combineAndUpload = async () => {
    // [MP-GUARD] Never run while a normal batch upload is in flight — both write the results
    // modal, and the loser's outcome would silently vanish.
    if (tray.pages.length === 0 || combining || uploading) return;
    setCombining(true);
    try {
      const pdf = await combineImagesToPdf(tray.files);
      const result = await uploadOne(pdf);
      // [MP-RETRY] On a transient upload failure, KEEP the collected pages + the panel so the
      // owner can retry — never make them re-photograph every page.
      if (result.status === "error") {
        toast(result.message || t('ink.upload.misluktOpnieuw'), { tone: "error" });
        return;
      }
      setMpOpen(false);
      tray.reset();
      onUploaded();
      setResults([result]);
      setShowResults(true);
    } catch (e) {
      // A combine failure names the failing page — keep the pages so the owner redoes only that one.
      toast(e instanceof Error && /Pagina/.test(e.message)
        ? `${e.message} ${t('ink.mp.paginasBewaard')}`
        : t('ink.mp.combinerenMislukt'), { tone: "error" });
    } finally {
      setCombining(false);
    }
  };

  // ── [BATCH-HERKANSING] A second attempt, without going back to the file manager ────────────
  //
  // The file is on the row (see IntakeResult.file), so a retry is one press. Which rows may offer
  // one is decided by describeUploadFailure, not by the status: a 402 and a 413 give the identical
  // answer forever, and a button that is guaranteed to fail teaches the owner to distrust the ones
  // that work.
  const canRetry = (r: IntakeResult) =>
    !!r.file && !r.retrying && (r.status === "skipped" || (r.status === "error" && !r.noRetry));

  const runAgain = async (indexes: number[], force = false) => {
    const jobs = indexes
      .map((i) => ({ i, row: results[i] }))
      .filter(({ row }) => row && !!row.file && !row.retrying);
    if (jobs.length === 0) return;

    setResults((prev) => prev.map((r, i) => (jobs.some((j) => j.i === i) ? { ...r, retrying: true } : r)));
    for (const { i, row } of jobs) {
      const outcome = await uploadOne(row.file!, force);
      // Patch by INDEX and keep the file: a second failure must still be retryable, and the row
      // must not silently become a row about a different file.
      setResults((prev) => prev.map((r, at) => (at === i ? { ...outcome, retrying: false } : r)));
    }
    // A retry that landed changed the queue behind the modal, exactly like the first pass did.
    onUploaded();
  };

  const retryableIndexes = results.flatMap((r, i) => (canRetry(r) ? [i] : []));

  // [BATCH-HERKANSING] Leaving mid-batch loses whatever has not been sent yet, and the results
  // modal has not opened, so there is no trace at all of what did and did not go up. The browser
  // decides the wording; what matters is that the question gets asked.
  useEffect(() => {
    if (!uploading) return;
    const ask = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [uploading]);

  // [INTAKE-FEEDBACK] Close the modal AND refresh so new invoices show in the queue.
  const closeResults = () => {
    setShowResults(false);
    router.refresh();
  };

  const openInBestanden = (link: { folderId: string | null; focusId: string }) => {
    router.push(`/dashboard/bestanden?folder=${link.folderId ?? ""}&focus=${link.focusId}`);
  };

  // [INTAKE-FOCUS] "Naar controle →" — same full-navigation pattern as
  // openInBestanden/closeResults (this page reloads anyway to refresh the
  // queue); ?focus= makes the main component expand + scroll + ring the card.
  const goToInvoice = (invoiceId: string) => {
    window.location.assign(`/dashboard/incoming?focus=${invoiceId}`);
  };

  const addedCount = results.filter((r) => r.status === "invoice" || r.status === "document" || r.status === "bank").length;

  return (
    <div style={{ marginBottom: 32 }}>
      <div
        style={{
          fontSize: 13, fontWeight: 600, color: "#5f6368",
          textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10,
        }}
      >
        {t('ink.toevoegen')}
      </div>

      {/* [SMART-INTAKE-B] Camera button — fast path for the cashier (10 sec) */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.currentTarget.value = "";
        }}
      />
      <button
        onClick={() => !uploading && cameraInputRef.current?.click()}
        disabled={uploading}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          width: "100%", padding: "16px", borderRadius: 16, marginBottom: 10,
          background: uploading ? "#dadce0" : "#1a73e8", color: "#fff",
          border: "none", fontWeight: 700, fontSize: 16,
          cursor: uploading ? "not-allowed" : "pointer",
        }}
      >
        <span style={{ fontSize: 20 }}>📷</span>
        {uploading ? t('ink.upload.verwerken') : t('ink.upload.foto')}
      </button>

      {/* File / drag-drop (PDF, image, bank statement) — [INTAKE-MULTI] multiple */}
      <label
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
          padding: "20px", borderRadius: 16,
          border: `2px dashed ${dragOver ? "#1a73e8" : "#dadce0"}`,
          background: dragOver ? "#e8f0fe" : "#f8f9fa",
          cursor: uploading ? "not-allowed" : "pointer",
        }}
        onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <input
          type="file"
          multiple
          accept=".pdf,image/*,.xml,.ubl,.mt940,.sta,.camt,.053,.txt,.csv,.doc,.docx,.xls,.xlsx,.ods,.odt,.html,.htm,.eml,.p7m"
          style={{ display: "none" }}
          disabled={uploading}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.currentTarget.value = "";
          }}
        />
        <span style={{ fontSize: 28 }}>{uploading ? "⏳" : "📎"}</span>
        <span style={{ fontSize: 14, color: uploading ? "#5f6368" : "#1a73e8", fontWeight: 600 }}>
          {uploading
            ? (total > 1 ? t('ink.upload.voortgang', { n: current, totaal: total }) : t('ink.upload.verwerken'))
            : t('ink.upload.kies')}
        </span>
        <span style={{ fontSize: 12, color: "#5f6368" }}>
          {t('ink.upload.types', { max: MAX_BATCH })}
        </span>

        {/* [INTAKE-MULTI] Batch progress bar */}
        {uploading && total > 1 && (
          <div style={{ width: "100%", height: 4, background: "#e0e0e0", borderRadius: 9999, overflow: "hidden", marginTop: 4 }}>
            <div style={{
              width: `${Math.round((current / total) * 100)}%`,
              height: "100%", background: "#1a73e8", borderRadius: 9999,
              transition: "width 0.3s cubic-bezier(0.4,0,0.2,1)",
            }} />
          </div>
        )}
      </label>

      {/* [MULTI-PAGE] Hidden inputs for the multi-page flow (camera adds one page at a time;
          the file picker can add several images at once). Images only — pages of one invoice. */}
      <input
        ref={mpCameraRef} type="file" accept="image/*" capture="environment"
        style={{ display: "none" }}
        onChange={(e) => { addMpPages(e.target.files); e.currentTarget.value = ""; }}
      />
      <input
        ref={mpFileRef} type="file" accept="image/*" multiple
        style={{ display: "none" }}
        onChange={(e) => { addMpPages(e.target.files); e.currentTarget.value = ""; }}
      />

      {/* [MULTI-PAGE] Entry button — a paper invoice of 2+ pages photographed as several images. */}
      {!mpOpen ? (
        <button
          onClick={() => !uploading && setMpOpen(true)}
          disabled={uploading}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            width: "100%", padding: "12px", borderRadius: 14, marginTop: 10,
            background: "#fff", color: "#007aff", border: "1.5px solid #d1d1d6",
            fontWeight: 600, fontSize: 14, cursor: uploading ? "not-allowed" : "pointer",
          }}
        >
          <span style={{ fontSize: 17 }}>📄</span>
          {t('ink.meerderePaginas')}
        </button>
      ) : (
        <div style={{ marginTop: 10, padding: 14, borderRadius: 16, border: "1.5px solid #007aff", background: "#f5faff" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1c1c1e", marginBottom: 4 }}>
            {t('ink.eenFactuurMeerPaginas')}
          </div>
          <div style={{ fontSize: 12.5, color: "#5f6368", marginBottom: 12, lineHeight: 1.4 }}>
            {t('ink.mp.uitleg')}
          </div>

          {/* [PAGINA-VOLGORDE] Collected pages — thumbnails, and the order the owner can correct. */}
          <div style={{ marginBottom: 12 }}>
            <PageTray
              pages={tray.pages}
              notice={tray.notice}
              accent="#007aff"
              disabled={combining}
              onMove={tray.move}
              onRemove={tray.remove}
            />
          </div>

          {/* Add-page actions */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button onClick={() => !combining && mpCameraRef.current?.click()} disabled={combining}
              style={{ flex: 1, padding: "10px", borderRadius: 12, border: "1px solid #d1d1d6", background: "#fff", color: "#007aff", fontWeight: 600, fontSize: 13, cursor: combining ? "default" : "pointer" }}>
              {t('ink.mp.fotograferen')}
            </button>
            <button onClick={() => !combining && mpFileRef.current?.click()} disabled={combining}
              style={{ flex: 1, padding: "10px", borderRadius: 12, border: "1px solid #d1d1d6", background: "#fff", color: "#007aff", fontWeight: 600, fontSize: 13, cursor: combining ? "default" : "pointer" }}>
              {t('ink.mp.kiezen')}
            </button>
          </div>

          {/* Combine + cancel */}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={cancelMultiPage} disabled={combining}
              style={{ padding: "11px 16px", borderRadius: 12, border: "none", background: "#f1f3f4", color: "#5f6368", fontWeight: 600, fontSize: 14, cursor: combining ? "default" : "pointer" }}>
              {t('ink.annuleer')}
            </button>
            <button onClick={combineAndUpload} disabled={combining || uploading || tray.pages.length === 0}
              style={{ flex: 1, padding: "11px", borderRadius: 12, border: "none", fontWeight: 700, fontSize: 14,
                background: combining || uploading || tray.pages.length === 0 ? "#c7c7cc" : "#007aff", color: "#fff",
                cursor: combining || uploading || tray.pages.length === 0 ? "default" : "pointer" }}>
              {combining ? t('act.bezig') : tray.pages.length > 0 ? (tray.pages.length === 1 ? t('ink.mp.combineerEen') : t('ink.mp.combineerMeer', { n: tray.pages.length })) : t('ink.mp.voegEerstToe')}
            </button>
          </div>
        </div>
      )}

      {/* [MULTI-PAGE] Honest note: one PDF must be one invoice — the app reads a PDF as a single
          invoice (all pages together). A PDF holding several DIFFERENT invoices can't be split. */}
      <div style={{ fontSize: 11.5, color: "#8e8e93", marginTop: 8, lineHeight: 1.45 }}>
        {t('ink.mp.let')}
      </div>

      {/* [INTAKE-FEEDBACK] Results modal — where did each file go? */}
      {showResults && results.length > 0 && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 2000 }}
          onClick={closeResults}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: "20px 20px 0 0", padding: "24px 20px",
              paddingBottom: "calc(24px + var(--bottom-nav-h) + env(safe-area-inset-bottom))",
              width: "100%", maxWidth: 430, maxHeight: "80vh", overflowY: "auto",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 19, color: "#202124", marginBottom: 4 }}>
              {addedCount > 0
                ? (addedCount === 1 ? t('ink.result.eenToegevoegd') : t('ink.result.meerToegevoegd', { n: addedCount }))
                : t('ink.klaar')}
            </div>
            <div style={{ fontSize: 14, color: "#5f6368", marginBottom: 16 }}>
              {results.length > 1 ? t('ink.result.gebeurdMeer') : t('ink.result.gebeurdEen')}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {results.map((r, i) => {
                const meta = RESULT_META[r.status];
                return (
                  <div key={i} style={{ display: "flex", gap: 10, padding: "10px 12px", borderRadius: 12, background: "#f8f9fa" }}>
                    <span style={{ fontSize: 16, lineHeight: "20px" }}>{meta.icon}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "#202124", margin: "0 0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.name}
                      </p>
                      {/* [AUTO-ADVANCE-HONESTY] WHAT happened, in the app's own words, before the
                          server's sentence. The message alone could not distinguish an invoice
                          that is waiting for a tap from one that is already booked — and those
                          are the two outcomes the owner must never confuse. */}
                      <p style={{ fontSize: 12, color: meta.color, margin: 0, fontWeight: 600 }}>{t(meta.labelKey)}</p>
                      <p style={{ fontSize: 12, color: "#5f6368", margin: 0 }}>{r.message}</p>
                      {r.link && (
                        <button
                          type="button"
                          onClick={() => openInBestanden(r.link!)}
                          style={{ marginTop: 6, background: "none", border: "none", padding: 0, cursor: "pointer", color: "#1a73e8", fontSize: 12, fontWeight: 600, textDecoration: "underline" }}
                        >
                          {t('ink.bekijkBestanden')} →
                        </button>
                      )}
                      {/* [INTAKE-FOCUS] Invoice/receipt landed in THIS queue,
                          hidden behind this modal — give the owner the path to
                          it instead of just "controleer en bevestig". */}
                      {r.status === "invoice" && r.invoiceId && (
                        <button
                          type="button"
                          onClick={() => goToInvoice(r.invoiceId!)}
                          style={{ marginTop: 6, background: "none", border: "none", padding: 0, cursor: "pointer", color: "#1a73e8", fontSize: 12, fontWeight: 600, textDecoration: "underline" }}
                        >
                          {t('ink.naarControle')} →
                        </button>
                      )}
                      {/* [AUTO-ADVANCE-HONESTY] Already booked → the link goes where the invoice
                          actually IS (Inkoopfacturen), never to a queue it never entered. */}
                      {r.status === "auto" && (
                        <Link
                          href={r.invoiceId ? `/dashboard/incoming/manage?focus=${r.invoiceId}` : "/dashboard/incoming/manage"}
                          style={{ marginTop: 6, display: "inline-block", color: "#1a73e8", fontSize: 12, fontWeight: 600, textDecoration: "underline" }}
                        >
                          {t('ink.result.naarInkoop')} →
                        </Link>
                      )}
                      {/* [CIRKEL] A bank statement dropped on THIS page imported fine — and the
                          row then offered nowhere to go, while the same outcome via the intake
                          button pushes to /dashboard/bank. One destination for both doors. */}
                      {r.status === "bank" && (
                        <Link
                          href="/dashboard/bank?tab=confirm&quarter=all"
                          style={{ marginTop: 6, display: "inline-block", color: "#1a73e8", fontSize: 12, fontWeight: 600, textDecoration: "underline" }}
                        >
                          {t('ink.result.naarBank')} →
                        </Link>
                      )}
                      {/* [BATCH-HERKANSING] The second attempt, on the file this row is about.
                          Only where it can actually succeed — see canRetry. */}
                      {canRetry(r) && (
                        <button
                          type="button"
                          onClick={() => runAgain([i])}
                          style={{ marginTop: 6, background: "none", border: "none", padding: 0, cursor: "pointer", color: "#1a73e8", fontSize: 12, fontWeight: 600, textDecoration: "underline" }}
                        >
                          {t('ink.result.opnieuw')}
                        </button>
                      )}
                      {/* A semantic duplicate the SERVER says may be overridden. The byte-hash
                          gate never sets canForce, so an identical file still cannot slip past. */}
                      {r.status === "duplicate" && r.canForce && !r.retrying && (
                        <button
                          type="button"
                          onClick={() => runAgain([i], true)}
                          style={{ marginTop: 6, marginInlineStart: 12, background: "none", border: "none", padding: 0, cursor: "pointer", color: "#9a5b00", fontSize: 12, fontWeight: 600, textDecoration: "underline" }}
                        >
                          {t('ink.result.tochToevoegen')}
                        </button>
                      )}
                      {r.retrying && (
                        <p style={{ fontSize: 12, color: "#5f6368", margin: "6px 0 0", fontWeight: 600 }}>{t('act.bezig')}</p>
                      )}
                    </div>
                    {/* [MELDING-WEG] Read it, take it away — one row at a time, the green button
                        below still closes them all. Not while a retry is in flight: that row is
                        about to change, and the outcome must land on it. */}
                    {!r.retrying && (
                      <DismissX label={t('melding.weghalen')} onClick={() => setResults((prev) => prev.filter((_, j) => j !== i))} />
                    )}
                  </div>
                );
              })}
            </div>

            {/* [BATCH-HERKANSING] One press for every row that can still succeed. On a drop of
                twenty this is the difference between finishing the batch and re-picking files by
                hand — which is where a purchase invoice quietly never gets added. */}
            {retryableIndexes.length > 0 && (
              <button
                onClick={() => runAgain(retryableIndexes)}
                style={{
                  width: "100%", padding: "14px", borderRadius: 14, marginBottom: 10,
                  background: "#fff", color: "#1a73e8", border: "1.5px solid #1a73e8",
                  fontWeight: 700, fontSize: 15, cursor: "pointer",
                }}
              >
                {retryableIndexes.length === 1
                  ? t('ink.result.alleOpnieuwEen')
                  : t('ink.result.alleOpnieuwMeer', { n: retryableIndexes.length })}
              </button>
            )}

            <button
              onClick={closeResults}
              style={{
                width: "100%", padding: "16px", borderRadius: 14,
                background: "#34a853", color: "#fff", border: "none",
                fontWeight: 700, fontSize: 16, cursor: "pointer",
              }}
            >
              {t('ink.klaar')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function IncomingInvoicesClient({
  initialInvoices,
  ignoredInvoices,
  confirmedInvoices,
  connectionStatus,
  // [READING-MEMORY] Empty by default: most owners have no supplier past the threshold, and a
  // missing prop must render the queue exactly as it rendered before this existed.
  readingHints = {},
  // Leeg bij afwezigheid: een oudere serverrender toont dan precies wat dit scherm altijd toonde.
  vendorRates = {},
  // [NO-SILENT-EMPTY] Defaults to empty, so an older server render behaves exactly as before —
  // but an EMPTY array means "every read succeeded", which is a claim, not an absence.
  readFailed = [],
  // [LEVERANCIER-KIEZEN] Empty by default: an older server render, or a brand-new account, gets
  // exactly the field this screen has always had.
  suppliers = [],
  suppliersUnavailable = false,
}: Props) {
  const t = translator(useLocale())
  const dialog = useDialog();
  const toast = useToast();
  const router = useRouter();
  // [BOEK-011] Navigation paths — resolved through the central navigation helper
  // [SUBNAV] Logo (home) + Terug (canonical parent) now come from the shared
  // sub-page header (DashboardChrome), so this page no longer computes them.

  const [pending, setPending] = useState<IncomingInvoice[]>(initialInvoices);
  const [ignored, setIgnored] = useState<IncomingInvoice[]>(ignoredInvoices);
  // [WACHTRIJ-VERS] useState reads its initial value ONCE, so every router.refresh() on this page
  // delivered fresh rows to a hook that had already made up its mind — including the one at
  // handleReimport, whose own comment says "pick up the refreshed amounts + health". A card
  // therefore kept the amounts read at page load, and the verify modal opens seeded from that card:
  // the owner reviewing a just-corrected invoice was shown, and confirmed, the number the
  // correction had replaced.
  //
  // Content only. Membership stays the screen's, or a refresh landing inside an optimistic removal
  // would put a confirmed invoice back in the queue — see the rule and its tests in queue-sync.ts.
  //
  // Adjusted DURING RENDER, not in an effect. React supports exactly this shape for "a prop
  // changed, so a piece of state derived from it must move with it": the re-render happens before
  // anything is committed, so the screen never paints the stale row. An effect would paint it
  // first and correct it a frame later — a cascading render this file already warns about at three
  // other call sites, and one the linter refuses outright.
  const [pendingSeed, setPendingSeed] = useState(initialInvoices);
  if (pendingSeed !== initialInvoices) {
    // Reference identity, deliberately: a server render always produces a NEW array, and comparing
    // contents here would mean walking the whole queue on every render to answer a question the
    // pointer already answers.
    setPendingSeed(initialInvoices);
    setPending((prev) => applyServerRefresh(prev, initialInvoices));
  }
  const [ignoredSeed, setIgnoredSeed] = useState(ignoredInvoices);
  if (ignoredSeed !== ignoredInvoices) {
    setIgnoredSeed(ignoredInvoices);
    setIgnored((prev) => applyServerRefresh(prev, ignoredInvoices));
  }
  // [INCOMING-BEVESTIGD] Read-only surface of recently confirmed invoices — no mutations here.
  const [confirmed] = useState<IncomingInvoice[]>(confirmedInvoices);
  const [tab, setTab] = useState<Tab>("pending");
  // [SEARCH] In-page live filter — dedicated to this page only. Filters the loaded
  // incoming invoices (supplier / invoice number / amount) instantly, in place.
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // [INTAKE-FOCUS] Deep-link target from the upload results modal
  // ("Naar controle →" navigates to /dashboard/incoming?focus={invoiceId}).
  // On mount: expand the card, scroll it into view, show a brief ring, then
  // clean the param so a later manual refresh doesn't re-trigger. Reading
  // window.location (client-only) avoids the useSearchParams Suspense
  // requirement — this effect never runs on the server.
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("focus");
    if (!id) return;
    // [ZOEK-LANDT] Switch to the tab that HOLDS this invoice before trying to scroll to it.
    //
    // GEMELD: "ik zocht hem in de zoekbalk en hij opende hem niet, ook zijn plek niet." Precies
    // dat: de zoekactie vindt een gearchiveerde factuur (het invoices-filter sluit geen enkele
    // status uit) en linkt naar /incoming?focus=. Dit scherm opent altijd op `pending`, en een
    // gearchiveerde rij staat in `ignored`. De kaart stond dus niet in de DOM,
    // getElementById gaf null, landRowUnderChrome deed niets — en er gebeurde NIETS. Geen fout,
    // geen melding, geen kaart.
    //
    // De zoekroute kent dit gat al: haar eigen commentaar zegt dat /incoming?focus= "opened the
    // verify tab, which neither contains confirmed rows nor switches tabs". Dat werd opgelost voor
    // BEVESTIGDE rijen, door die naar /incoming/manage te sturen. Voor gearchiveerde rijen geldt
    // dezelfde zin nog woord voor woord — dit is de andere helft van die oplossing.
    const inPending = pending.some((i) => i.id === id);
    const inIgnored = ignoredInvoices.some((i) => i.id === id);
    // Alles wat state raakt gaat door DEZE ene tick — nooit synchroon in de effect-body. Dat is de
    // regel die hier al gold voor het uitklappen, en eslint dwingt hem af (cascading renders).
    const applyTimer = setTimeout(() => {
      // [NO-SILENT-EMPTY] Op geen van beide lijsten: zeg dat. Stil niets doen is precies wat de
      // eigenaar meemaakte — hij klikt een zoekresultaat, belandt op dit scherm, en er gebeurt
      // niets. "Hij staat hier niet meer" is een antwoord; stilte is er geen.
      if (!inPending && !inIgnored) {
        toast(t('ink.zoek.nietHier'));
        return;
      }
      if (!inPending && inIgnored) setTab("ignored");
      setFocusId(id);
      setExpandedId(id);
    }, 0);
    window.history.replaceState({}, "", window.location.pathname);
    const focusTimer = setTimeout(() => setFocusId(null), 2600);
    return () => { clearTimeout(applyTimer); clearTimeout(focusTimer); };
  }, []);
  useEffect(() => {
    if (!focusId) return;
    // rAF: let the (possibly expanded) card lay out before we scroll to it.
    // [FOCUS-KOP] On the card's HEAD, not its middle. The effect above expands it
    // (setExpandedId(id)), and this screen's detail panel is the largest of the four — centring a
    // card taller than the viewport puts its top, its supplier and its amount off the top of the
    // screen. No toolbar of its own here, so the shared sub-page header is the whole chrome.
    requestAnimationFrame(() => {
      landRowUnderChrome(
        document.getElementById(`incoming-card-${focusId}`),
        null,
        PAGE_HEADER_HEIGHT,
      );
    });
  }, [focusId, pending]);

  // Modal state
  const [confirmPaidFor, setConfirmPaidFor] = useState<IncomingInvoice | null>(null);
  // [QUEUE-EDIT-UX] card "Bewerken" → same verify modal, edit fields pre-opened.
  const [editFor, setEditFor] = useState<IncomingInvoice | null>(null);
  const [ignoreFor, setIgnoreFor] = useState<IncomingInvoice | null>(null);
  // [NEGEER-REDEN] De keuze in de negeer-dialoog. Altijd null bij het openen — nooit een
  // voorgeselecteerde reden, want dan legt het scherm de eigenaar een antwoord in de mond.
  const [ignoreReason, setIgnoreReason] = useState<ArchiveReason | null>(null);
  // [AFZENDERREGEL] De factuur waarvoor we zojuist "altijd negeren van deze afzender" aanbieden,
  // en de regels die al gelden (getoond bij Genegeerd, zodat ze op te heffen zijn).
  const [ruleOfferFor, setRuleOfferFor] = useState<IncomingInvoice | null>(null);
  const [senderRules, setSenderRules] = useState<{ id: string; sender_email: string }[]>([]);
  // [RITME] Leveranciers met een vast ritme waarvan de verwachte factuur uitblijft. Verreweg
  // meestal leeg — dan is er ook geen banner. Zie de drie zwijg-regels in supplier-cadence.ts.
  const [missing, setMissing] = useState<{ supplier: string; reason: string; lastSeen: string }[]>([]);
  // [BETAALD-GEEN-STUK] Betalingen aan een bekende leverancier waar geen factuur aan hangt.
  const [unpaired, setUnpaired] = useState<{ transactionId: string; date: string; amount: number; supplier: string }[]>([]);
  const [missingDismissed, setMissingDismissed] = useState(false);

  // [IGNORE-UNDO] Een toast met een handeling erin ("Ongedaan maken"). De tijd staat bewust
  // langer (7s) wanneer er iets te ondoen valt: 3 seconden is genoeg om iets te LEZEN, niet om
  // te beslissen dat je het toch niet wilde.
  // [MOTION] De weergave komt nu van de app-brede snackbar (components/ui/Toast); deze wikkel
  // vertaalt alleen de lokale {label, run}-vorm naar {label, onClick}, zodat de ruim twintig
  // aanroepen hieronder ongewijzigd blijven.
  const showToast = (msg: string, action?: { label: string; run: () => void }) =>
    toast(msg, action
      ? { action: { label: action.label, onClick: action.run }, duration: 7000 }
      : { duration: 3000 });

  // OAuth result toast — shown on the next tick (never synchronously in the
  // effect body — avoids a cascading re-render during the effects pass).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const error = params.get("error");
    if (!connected && !error) return;
    const msg = connected
      ? t('ink.oauth.verbonden', { provider: connected === "gmail" ? "Gmail" : "Outlook" })
      : t('ink.oauth.mislukt');
    const timer = setTimeout(() => showToast(msg), 0);
    window.history.replaceState({}, "", window.location.pathname);
    return () => clearTimeout(timer);
  }, []);

  // ── [BRIDGE-B] Verify — processing → received (shared Crediteur, unpaid) ──
  const handleVerify = useCallback(
    async (
      invoice: IncomingInvoice,
      amounts: {
        total_ex_btw: number; btw_amount: number; total_inc_btw: number;
        client_name: string; invoice_number: string; invoice_date: string;
      }
    ) => {
      // Optimistic — remove from pending
      setPending((prev) => prev.filter((inv) => inv.id !== invoice.id));
      setConfirmPaidFor(null);
      setEditFor(null); // [QUEUE-EDIT-UX] close whichever entry point opened the modal
      setExpandedId(null);

      try {
        const res = await fetch(`/api/email/confirm/${invoice.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // [AUTO-CONFIRM-ONCE] NO deferAutoConfirm here, deliberately. A single verify does cost
          // two full-account scans (the server's inline one, then ours below, which does strictly
          // more — /api/bank/auto-confirm also applies the learned bank categories). Skipping the
          // server's would halve that, but it would also trade a guarantee that ships with the
          // write itself for a second, separate request that can simply fail. For ONE invoice that
          // is a bad trade: the cost is one extra scan, the risk is an already-paid invoice reading
          // as unpaid until the hourly cron. The N+1 that actually hurt is the BULK loop, and that
          // is where the flag is sent.
          body: JSON.stringify({ action: "verify", ...amounts }),
        });
        if (res.ok) {
          // [BANK-AUTO-RUN] The invoice is now verified ('received') and matchable. If the
          // bank line that paid it is already waiting, book that link right here — the owner
          // never has to open /bank to connect a payment that's already in. Best-effort.
          const booked = await triggerBankAutoConfirm();
          showToast(
            booked > 0
              ? (booked === 1 ? t('ink.geverifieerd.metKoppelingEen') : t('ink.geverifieerd.metKoppelingMeer', { n: booked }))
              : t('ink.geverifieerd')
          );
        } else {
          // [UI-HONESTY] The server rejected it — roll back the optimistic remove so the invoice
          // stays visible in the queue instead of vanishing on a lie.
          //
          // Roll back FIRST, then read the body: a non-JSON error page (a platform 502, an auth
          // redirect) makes .json() throw, and if that threw before the rollback the invoice would
          // disappear from the only screen that can verify it. The .catch keeps it from throwing
          // at all — the same shape used everywhere else in this file.
          setPending((prev) => (prev.some((p) => p.id === invoice.id) ? prev : [invoice, ...prev]));
          // [SERVER-REASON] Say WHAT the server said. It answers with precise, owner-facing Dutch —
          // "Factuurdatum ontbreekt — voer eerst de factuurdatum in", or the 409 "Deze factuur is al
          // bevestigd — ververs de pagina". None of it used to arrive: the fixed sentence below
          // claimed the invoice was "still in the queue" and invited a retry, which on that 409 is
          // a retry that can never succeed — the row is already confirmed on the server.
          showToast(await confirmFailureMessage(res, t('ink.fout.verificatie')));
        }
      } catch {
        setPending((prev) => (prev.some((p) => p.id === invoice.id) ? prev : [invoice, ...prev]));
        showToast(t('ink.fout.nogInWachtrij'));
      }
    },
    []
  );

  // ── [INTAKE-VERIFY-BULK] Bulk verify — select many → confirm via modal ──
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  useCloseOnBack(!!bulkConfirmOpen, () => setBulkConfirmOpen(false))
  const [bulkRunning, setBulkRunning] = useState(false);

  // ── [BULK-IGNORE] Dezelfde selectie, de andere uitgang ──
  // De wachtrij loopt vol met twee soorten post tegelijk: facturen die bevestigd moeten worden, en
  // rommel (reclame, dubbelingen, post van de buurman). Voor de eerste soort was er één tik voor
  // een hele stapel; voor de tweede moest je twintig keer dezelfde drie tikken doen. Dat verschil
  // had geen reden — het was er gewoon nooit gebouwd.
  const [bulkIgnoreOpen, setBulkIgnoreOpen] = useState(false);
  // Eén reden voor de hele stapel, en net als bij de losse dialoog: altijd leeg bij openen. Wie
  // twintig reclamemails wegzet kiest één keer "geen factuur"; dat is precies wat er te zeggen valt.
  const [bulkIgnoreReason, setBulkIgnoreReason] = useState<ArchiveReason | null>(null);
  const [bulkIgnoreRunning, setBulkIgnoreRunning] = useState(false);
  const [bulkIgnoreDone, setBulkIgnoreDone] = useState(0);

  // ── [REIMPORT-ALL] One-tap re-read of every "Aandacht nodig" invoice ──
  // Re-runs the extractor over each flagged invoice's stored file, exactly like the
  // per-card "Opnieuw inlezen" — improve-or-keep, never auto-verifies, status stays
  // 'processing'. So each invoice keeps its own current state; only the READ is redone.
  const [reimportAllRunning, setReimportAllRunning] = useState(false);
  const [reimportAllDone, setReimportAllDone] = useState(0);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()); };

  // "Selecteer alle" picks only the READY ones (health ok); needs-review invoices
  // stay out so they get individual attention.
  const selectAllReady = () => {
    setSelected(new Set(
      pending.filter((p) => p.health.level !== "needs-review").map((p) => p.id)
    ));
  };

  // Sequential batch verify — uses each invoice's extracted amounts as-is (no
  // per-invoice review). Optimistic remove on success; partial failures reported.
  const handleVerifyBatch = useCallback(async () => {
    const targets = pending.filter((p) => selected.has(p.id));
    if (targets.length === 0) return;
    // [TRUST-BULK] Bulk verify books the stored amounts AS-IS, with no per-invoice
    // review. So a card flagged "Aandacht nodig" (an uncertain/likely-wrong amount, a
    // missing date, a rekenfout) must NEVER be swept into a batch unseen — that is the
    // one path that could write a known-uncertain number into the accountant's books.
    // We confirm only the clean ones and send the flagged ones back for individual
    // review, honestly. (selectAllReady already excludes them; this guards the manual
    // hand-tap case too.)
    const flagged = targets.filter((p) => p.health.level === "needs-review");
    const cleanTargets = targets.filter((p) => p.health.level !== "needs-review");
    if (cleanTargets.length === 0) {
      setBulkConfirmOpen(false);
      showToast(flagged.length > 1 ? t('ink.bulk.aandachtMeer', { n: flagged.length }) : t('ink.bulk.aandachtEen'));
      return;
    }
    setBulkConfirmOpen(false);
    setBulkRunning(true);

    let ok = 0;
    const failedNames: string[] = [];
    for (const inv of cleanTargets) {
      try {
        const res = await fetch(`/api/email/confirm/${inv.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "verify",
            // [AUTO-CONFIRM-ONCE] The whole point of this loop's own comment below: ONE pass after
            // the batch, never one per invoice. The server ran a full-account scan on every single
            // POST, so a batch of 50 did 50 of them — and then we added a 51st. Now it does none
            // and the one after the loop is the only one.
            //
            // The trade this accepts, stated plainly: if the tab is closed part-way through a
            // batch, those invoices get no scan until the hourly cron (api/cron/reconcile) or the
            // next /bank load picks them up. That is a delay, never a loss — and it is the design
            // the loop already documented for itself. Per-invoice scanning was never the guarantee
            // it looked like: it re-read the owner's whole account N times to find, at most, what
            // one pass at the end finds anyway.
            deferAutoConfirm: true,
            // [BULK-GEEN-ECHO] And NOTHING else. The block above says what this path is — "books
            // the stored amounts AS-IS, with no per-invoice review" — and it then sent six fields
            // copied out of this component's state, which is not the same thing at all.
            //
            // The confirm route treats every field as optional and keeps what is stored when one is
            // absent, so these six added no information. What they could do is OVERWRITE. This list
            // is seeded from the server render and never updated afterwards: `pending` holds the
            // rows as they were when the page loaded, and router.refresh() cannot change that —
            // useState ignores a new initial value. So after "Opnieuw inlezen" corrected an amount,
            // or after a correction made in another tab, a bulk confirm wrote the OLD numbers back
            // over the new ones, and the invoice went into the books and the aangifte wrong. A
            // human being reviewed nothing on this path, so there was nobody to notice.
            //
            // The single verify still sends amounts, and must: those come from the modal, typed or
            // approved by the owner looking at the document.
          }),
        });
        if (res.ok) {
          ok++;
          setPending((prev) => prev.filter((p) => p.id !== inv.id));
        } else {
          failedNames.push(inv.client_name || inv.invoice_number);
        }
      } catch {
        failedNames.push(inv.client_name || inv.invoice_number);
      }
    }

    setBulkRunning(false);
    setSelectMode(false);
    setSelected(new Set());
    // [BANK-AUTO-RUN] ONE auto-confirm pass after the whole batch (never per invoice — that
    // would re-scan the full set N times). Everything just verified is now matchable; any bank
    // lines already waiting for them get booked in a single sweep.
    const booked = ok > 0 ? await triggerBankAutoConfirm() : 0;
    const heldNote = flagged.length > 0 ? ` · ${t('ink.bulk.overgeslagenNote', { n: flagged.length })}` : "";
    const bookedNote = booked > 0 ? ` · ${booked === 1 ? t('ink.gekoppeld.een') : t('ink.gekoppeld.meer', { n: booked })}` : "";
    if (failedNames.length === 0) {
      showToast(`${ok > 1 ? t('ink.bulk.geverifieerdMeer', { n: ok }) : t('ink.bulk.geverifieerdEen')}${bookedNote}${heldNote}`);
    } else {
      showToast(`${t('ink.bulk.deelsMislukt', { ok, mislukt: failedNames.length })}${heldNote} — ${t('ink.bulk.ververs')}`);
    }
  }, [pending, selected]);

  // ── [BRIDGE-B] Pay — → paid (requires payment_method: bank | kas) ──
  const handlePay = useCallback(
    async (
      invoice: IncomingInvoice,
      amounts: {
        total_ex_btw: number; btw_amount: number; total_inc_btw: number;
        client_name: string; invoice_number: string; invoice_date: string;
      },
      method: "bank" | "kas",
      // [BRIDGE-QUARTER] real payment date (YYYY-MM-DD)
      paymentDate: string
    ) => {
      // Optimistic — remove from pending
      setPending((prev) => prev.filter((inv) => inv.id !== invoice.id));
      setConfirmPaidFor(null);
      setEditFor(null); // [QUEUE-EDIT-UX] close whichever entry point opened the modal
      setExpandedId(null);

      try {
        const res = await fetch(`/api/email/confirm/${invoice.id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "pay",
            payment_method: method,
            payment_date: paymentDate,
            ...amounts,
          }),
        });
        if (res.ok) {
          showToast(t('ink.betaaldGemarkeerd'));
        } else {
          // [UI-HONESTY] Roll back the optimistic remove — the payment was NOT recorded.
          // [SERVER-REASON] …and then say why, in the server's own words (see handleVerify).
          // NB: no deferAutoConfirm on this path — it runs no pass of its own, so the server's
          // inline one is the only one there is.
          setPending((prev) => (prev.some((p) => p.id === invoice.id) ? prev : [invoice, ...prev]));
          showToast(await confirmFailureMessage(res, t('ink.fout.bevestiging')));
        }
      } catch {
        setPending((prev) => (prev.some((p) => p.id === invoice.id) ? prev : [invoice, ...prev]));
        showToast(t('ink.fout.nogInWachtrij'));
      }
    },
    []
  );

  // ── Restore ignored → pending ──
  // [IGNORE-UNDO] Staat bewust VÓÓR handleIgnore: de "Ongedaan maken"-knop in de negeer-toast
  // roept dit pad aan, en zo hoeft dat niet via een ref (die de React-compiler terecht weigert:
  // een ref muteren rond de render is een side-effect). Eén herstelpad, één waarheid.
  const handleRestore = useCallback(async (invoice: IncomingInvoice) => {
    setIgnored((prev) => prev.filter((inv) => inv.id !== invoice.id));
    setPending((prev) => [invoice, ...prev]);
    setExpandedId(null);

    // [UI-HONESTY] Same as ignore: only claim "teruggezet" when the server actually accepted it;
    // otherwise roll back to the ignored list so the UI reflects the real state.
    const rollback = () => {
      setPending((prev) => prev.filter((inv) => inv.id !== invoice.id));
      setIgnored((prev) => (prev.some((p) => p.id === invoice.id) ? prev : [invoice, ...prev]));
    };
    try {
      const res = await fetch(`/api/email/confirm/${invoice.id}`, { method: "PATCH" });
      if (res.ok) {
        showToast(t('ink.teruggezetToast'));
      } else {
        // [SERVER-REASON] The PATCH answers "Deze factuur staat niet (meer) in Genegeerd — ververs
        // de pagina" on a 409. "Probeer opnieuw" is the one thing that will NOT help there.
        rollback();
        showToast(await confirmFailureMessage(res, t('ink.fout.terugzetten')));
      }
    } catch {
      rollback();
      showToast(t('ink.fout.opnieuw'));
    }
  }, []);

  // ── [BULK-IGNORE] De terugweg voor een hele stapel ──
  // Eén PATCH per factuur — exact hetzelfde herstelpad als de losse knop, dus er is geen tweede
  // waarheid over wat "terugzetten" betekent. Bewust GEEN hergebruik van handleRestore zelf: die
  // toont per factuur een snackbar, en twintig snackbars achter elkaar is geen bevestiging maar
  // een storing. Verplaatsen doen we hier pas NA het antwoord van de server, per factuur.
  const restoreMany = useCallback(async (invoices: IncomingInvoice[]) => {
    let ok = 0;
    let failed = 0;
    for (const inv of invoices) {
      try {
        const res = await fetch(`/api/email/confirm/${inv.id}`, { method: "PATCH" });
        if (res.ok) {
          ok++;
          setIgnored((prev) => prev.filter((p) => p.id !== inv.id));
          setPending((prev) => (prev.some((p) => p.id === inv.id) ? prev : [inv, ...prev]));
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }
    showToast(bulkRestoreSummary(ok, failed));
  }, []);

  // ── Ignore — archive ──
  const handleIgnore = useCallback(async (invoice: IncomingInvoice, reason: ArchiveReason | null) => {
    setPending((prev) => prev.filter((inv) => inv.id !== invoice.id));
    // [NEGEER-REDEN] Optimistisch mee in de lijst, zodat het label meteen klopt met wat er
    // zojuist gekozen is — ook vóór de volgende paginalading.
    setIgnored((prev) => [{ ...invoice, archive_reason: reason }, ...prev]);
    setIgnoreFor(null);
    setIgnoreReason(null);
    setExpandedId(null);

    // [UI-HONESTY] A fetch that resolves is NOT proof of success — a 4xx/5xx (not found, RLS reject)
    // resolves with res.ok=false. The old code showed "genegeerd" regardless, so a failed ignore
    // looked done. Check res.ok and, on failure, roll back to the queue and say so.
    const rollback = () => {
      setIgnored((prev) => prev.filter((inv) => inv.id !== invoice.id));
      setPending((prev) => (prev.some((p) => p.id === invoice.id) ? prev : [invoice, ...prev]));
    };
    try {
      const res = await fetch(`/api/email/confirm/${invoice.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        // [IGNORE-UNDO] Negeren is één tik en het haalt een factuur uit beeld — dus hoort de weg
        // terug in dezelfde tik te zitten, niet in een tabblad dat je eerst moet vinden. Hergebruikt
        // exact het herstelpad van de Genegeerd-lijst (PATCH), dus er is geen tweede waarheid.
        // [AFZENDERREGEL] Alleen bij "geen factuur" bieden we de blijvende regel aan: dat is de
        // enige reden die iets zegt over wat dit ADRES structureel stuurt. "Dubbel" en "niet van
        // mij" gaan over deze ene factuur — daar een regel van maken zou echte post laten
        // verdwijnen. Het aanbod is een tweede scherm, nooit iets dat vanzelf gebeurt.
        if (mayOfferSenderRule(reason, invoice.client_email)) {
          setRuleOfferFor(invoice);
          showToast(t('ink.genegeerdToast'));
        } else {
          showToast(t('ink.genegeerdToast'), {
            label: t('ink.ongedaanMaken'),
            run: () => { void handleRestore(invoice); },
          });
        }
      } else {
        // [SERVER-REASON] DELETE refuses with money_settled / bank_linked and a `detail` that names
        // the way out ("draai eerst de betaling terug", "ontkoppel die eerst op de Bank-pagina").
        // Both are PERMANENT — retrying is exactly what cannot work. Prefer `detail`: this route's
        // `error` is a CODE (or, at the 500, a raw Postgres string), never a sentence for a phone.
        rollback();
        // DELETE answers with a CODE in `error` and the written sentence in `detail` — so this one
        // reads `detail`, and the same 5xx rule applies (there `detail` is a raw Postgres string).
        showToast(await confirmFailureMessage(res, t('ink.fout.negeren'), "detail"));
      }
    } catch {
      rollback();
      showToast(t('ink.fout.nogInWachtrij'));
    }
  }, [handleRestore]);

  // ── [BULK-IGNORE] Negeer de hele selectie ──
  //
  // Drie keuzes die hier bewust ANDERS zijn dan bij het bevestigen van een stapel — en die alle
  // drie uit hetzelfde verschil volgen: bevestigen schrijft geld in de boeken, negeren haalt een
  // rij uit een wachtrij en is met één tik terug te draaien.
  //
  //  1. GEEN gezondheidsfilter. handleVerifyBatch weigert "Aandacht nodig"-facturen ([TRUST-BULK]):
  //     die zou hij ongezien met een onzeker bedrag in de boeken zetten. Hier is het omgekeerde
  //     waar — een reclamefolder of een onleesbare scan is juist ALTIJD gemarkeerd, dus precies wat
  //     je wilt wegzetten. Ze eruit filteren zou de knop nutteloos maken voor waar hij voor is.
  //     Wie dit later "gelijktrekt met bevestigen" sloopt de functie; vandaar deze alinea.
  //  2. NIET optimistisch verplaatsen. De losse knop haalt de kaart meteen weg en rolt terug bij
  //     een fout — prettig bij één factuur, en één rollback. Bij twintig zou dat twintig
  //     rollbacks zijn die door elkaar lopen. Hier draait een overlay over de pagina, dus er is
  //     niets te winnen met vooruitlopen: elke factuur verhuist pas als de server ja heeft gezegd.
  //  3. GEEN afzenderregel aanbieden. Het losse pad biedt na "geen factuur" aan om post van dat
  //     adres voortaan over te slaan. Twintig van die dialogen achter elkaar is geen aanbod maar
  //     een hinderlaag — en de regel die post ONGEZIEN tegenhoudt verdient sowieso zijn eigen ja
  //     (zie het [AFZENDERREGEL]-blok). Die weg blijft dus per factuur lopen.
  const handleIgnoreBatch = useCallback(async () => {
    const targets = pending.filter((p) => selected.has(p.id));
    // Een selectie kan tussen kiezen en bevestigen leeglopen: [REIMPORT-ALL] staat in dezelfde
    // knoppenrij en herlaadt de wachtrij, dus een aangevinkte factuur kan er dan niet meer in
    // staan. Zonder deze tak blijft de dialoog open staan bij een tik op "Ja, negeer" en gebeurt
    // er niets — een dode knop, en de eigenaar denkt dat het scherm hangt. Sluiten én zeggen.
    if (targets.length === 0) {
      setBulkIgnoreOpen(false);
      setBulkIgnoreReason(null);
      setSelectMode(false);
      setSelected(new Set());
      showToast(t('ink.bulk.nietMeerInWachtrij'));
      return;
    }
    const reason = bulkIgnoreReason;

    setBulkIgnoreOpen(false);
    setBulkIgnoreRunning(true);
    setBulkIgnoreDone(0);

    const tally: BulkIgnoreTally = { ok: 0, refused: 0, unavailable: 0 };
    // Wat er ECHT is gearchiveerd — alleen dit gaat mee in de "Ongedaan maken", nooit de hele
    // selectie. Een undo die facturen probeert terug te zetten die nooit weg zijn geweest, zou
    // met 409's terugkomen en de eigenaar vertellen dat er iets mis is terwijl alles klopt.
    const archived: IncomingInvoice[] = [];

    for (const inv of targets) {
      try {
        const res = await fetch(`/api/email/confirm/${inv.id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        });
        if (res.ok) {
          tally.ok++;
          archived.push(inv);
          setPending((prev) => prev.filter((p) => p.id !== inv.id));
          // [NEGEER-REDEN] Meteen mét de gekozen reden in de Genegeerd-lijst, zodat het label daar
          // klopt zonder een paginalading — net als bij het losse pad.
          setIgnored((prev) => (prev.some((p) => p.id === inv.id) ? prev : [{ ...inv, archive_reason: reason }, ...prev]));
        } else {
          tally[classifyIgnoreFailure(res.status)]++;
        }
      } catch {
        // Netwerkfout: geen status, en er is niets gewijzigd. classifyIgnoreFailure(0) → tijdelijk.
        tally[classifyIgnoreFailure(0)]++;
      }
      setBulkIgnoreDone((n) => n + 1);
    }

    setBulkIgnoreRunning(false);
    setBulkIgnoreReason(null);
    setSelectMode(false);
    setSelected(new Set());

    const message = bulkIgnoreSummary(tally);
    if (bulkIgnoreOffersUndo(tally)) {
      showToast(message, { label: t('ink.ongedaanMaken'), run: () => { void restoreMany(archived); } });
    } else {
      showToast(message);
    }
  }, [pending, selected, bulkIgnoreReason, restoreMany]);

  // [RITME] Eén keer per paginabezoek ophalen. Het is een read-only rekensom over bestaande
  // facturen — geen AI, geen kosten — en het antwoord is meestal een lege lijst.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/incoming/missing");
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (!cancelled && Array.isArray(data.missing)) setMissing(data.missing);
        // [BETAALD-GEEN-STUK] De waarneming naast de verwachting: geld weg, niets gekoppeld.
        if (!cancelled && Array.isArray(data.unpaired)) setUnpaired(data.unpaired);
      } catch {
        // Stil falen: dit is een extra oog, nooit iets waar de pagina op mag stukgaan.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── [AFZENDERREGEL] De regels van de eigenaar: ophalen, aanzetten, opheffen ──
  // Alleen geladen wanneer het Genegeerd-tabblad open staat: daar horen ze thuis (het is de plek
  // waar je kijkt als je iets mist) en zo kost het de wachtrij niets.
  const loadSenderRules = useCallback(async () => {
    try {
      const res = await fetch("/api/email/sender-rules");
      if (!res.ok) {
        // [UI-HONESTY] Een lege lijst tonen zou hier LIEGEN: er kunnen regels zijn die op dit
        // moment post tegenhouden, en dan denkt de eigenaar dat er niets staat terwijl hij ze
        // niet kan opheffen. De server maakt onderscheid tussen "tabel bestaat niet" (echt geen
        // regels, stille lege lijst) en een echte fout; die laatste zeggen we hardop.
        const data = await res.json().catch(() => ({}));
        // [SERVER-ZIN] A code here would say "rules_read_failed" where the comment above
        // promises the owner is told out loud what went wrong.
        if (data?.error) showToast(failureText(res.status, data, t('ink.regels.foutLezen')));
        return;
      }
      const data = await res.json().catch(() => ({}));
      setSenderRules(Array.isArray(data.rules) ? data.rules : []);
    } catch {
      showToast(t('ink.regels.foutLaden'));
    }
  }, []);

  const addSenderRule = useCallback(async (invoice: IncomingInvoice) => {
    setRuleOfferFor(null);
    try {
      const res = await fetch("/api/email/sender-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: invoice.client_email, invoice_id: invoice.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(data.sender_email ? t('ink.regels.ingesteld', { email: data.sender_email }) : t('ink.regels.ingesteldZonder'));
        void loadSenderRules();
      } else {
        // [UI-HONESTY] Nooit "regel ingesteld" zeggen als er niets is ingesteld.
        showToast(failureText(res.status, data, t('ink.regels.instellenMislukt')));
      }
    } catch {
      showToast(t('ink.regels.instellenVerbinding'));
    }
  }, [loadSenderRules]);

  const removeSenderRule = useCallback(async (email: string) => {
    // Optimistisch weg uit de lijst; bij een fout halen we de echte stand weer op.
    setSenderRules((prev) => prev.filter((r) => r.sender_email !== email));
    try {
      const res = await fetch(`/api/email/sender-rules?email=${encodeURIComponent(email)}`, { method: "DELETE" });
      if (res.ok) {
        showToast(t('ink.regels.opgeheven', { email }));
      } else {
        showToast(t('ink.regels.opheffenMislukt'));
        void loadSenderRules();
      }
    } catch {
      showToast(t('ink.regels.opheffenVerbinding'));
      void loadSenderRules();
    }
  }, [loadSenderRules]);

  // ── [REIMPORT-ALL] Re-read every flagged invoice in one tap ──
  // Sequential (never hammer the AI): one reimport call per "Aandacht nodig" invoice.
  // Each call is improve-or-keep and leaves status='processing', so an invoice's own
  // state is preserved — only its extraction is refreshed. One page reload at the end
  // picks up the new amounts + health for every card at once.
  const handleReimportAllNeedsAttention = useCallback(async () => {
    if (reimportAllRunning) return;
    const targets = pending.filter((p) => p.health.level === "needs-review");
    if (targets.length === 0) return;
    // [REREAD-STRONG] The re-read is a heavier, on-demand read per invoice; confirm before running
    // it across the whole flagged set so a large queue isn't kicked off (and the page blocked) by
    // an accidental tap.
    if (targets.length > 1) {
      const ok = await dialog.confirm({
        title: t('ink.herleesAlles.vraag', { n: targets.length }),
        message: t('ink.herleesAlles.uitleg'),
        confirmLabel: t('ink.herleesKnop'),
      });
      if (!ok) return;
    }
    setReimportAllRunning(true);
    setReimportAllDone(0);

    let reread = 0;
    let notInvoice = 0;
    // [HERLEES-ARCHIVEER] Hoeveel daarvan de server ook echt heeft weggezet. Apart geteld, want
    // "bleek geen factuur" en "is verplaatst naar Genegeerd" zijn twee verschillende beweringen en
    // de samenvatting mag alleen het tweede zeggen als het ook gebeurd is.
    let archivedNotInvoice = 0;
    let skipped = 0;
    let failed = 0;
    // [MODEL-CONFIG] If the server answers that the reading model is unavailable, NONE of the
    // following invoices will make it: it is one setting that is wrong for every read at once.
    // Carrying on is then not perseverance but walking into the same paid wall twenty times —
    // twenty round trips, twenty ticks off the rate limit, and one outage landing in the summary
    // twenty times as "failed" as if it were something different per invoice.
    let stoppedReason: string | null = null;
    // How many actually reached the server. Counted exactly rather than derived afterwards, so
    // "not attempted" is a fact and not a subtraction that quietly misfiles an invoice on the next
    // change.
    let attempted = 0;
    for (const inv of targets) {
      attempted++;
      try {
        const res = await fetch(`/api/email/reimport/${inv.id}`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) reread++;
        else if (data.notInvoice) { notInvoice++; if (data.archived) archivedNotInvoice++; }
        // 409 = the card is no longer 'processing' (e.g. the owner verified it just before this
        // reached it). That is not a failure — count it as skipped so the summary stays honest.
        else if (res.status === 409) skipped++;
        else if (data.code === "model_unavailable") {
          stoppedReason = failureText(res.status, data, t('ink.herleesAlles.modelWeg'));
          setReimportAllDone((n) => n + 1);
          break;
        }
        else failed++;
      } catch {
        failed++;
      }
      setReimportAllDone((n) => n + 1);
    }

    setReimportAllRunning(false);
    // A blocking summary only when something needs the owner's eye; otherwise the refreshed cards
    // are the feedback. "opnieuw ingelezen" (re-read), not "bijgewerkt" — reimport always re-reads
    // but keeps the stored amounts when the fresh read is no better, so it may not have changed.
    if (notInvoice > 0 || failed > 0 || stoppedReason) {
      const untried = Math.max(0, targets.length - attempted);
      // Kept as a dialog rather than a snackbar: this is a multi-line result
      // the owner has to act on, and it must not scroll away unread.
      await dialog.alert({
        // [MODEL-CONFIG] An aborted run is not called "done". The title is read first, and it must
        // not suggest the batch was handled when nothing happened.
        title: stoppedReason ? t('ink.herleesAlles.gestopt') : t('ink.herleesAlles.klaar'),
        message:
          (stoppedReason ? `${stoppedReason}\n\n` : "") +
          `• ${t('ink.herleesAlles.ingelezen', { n: reread })}\n` +
          (archivedNotInvoice
            ? `• ${t('ink.herleesAlles.weggezet', { n: archivedNotInvoice })}\n`
            : "") +
          (notInvoice - archivedNotInvoice > 0
            ? `• ${t('ink.herleesAlles.nietWeggezet', { n: notInvoice - archivedNotInvoice })}\n`
            : "") +
          (skipped ? `• ${t('ink.herleesAlles.overgeslagen', { n: skipped })}\n` : "") +
          (failed ? `• ${t('ink.herleesAlles.nietGelukt', { n: failed })}\n` : "") +
          // Not counted as "failed": these never reached the server. They sit unchanged in the
          // queue and nothing was attempted on them.
          (untried ? `• ${t('ink.herleesAlles.nietGeprobeerd', { n: untried })}` : ""),
      });
    }
    router.refresh();
  }, [pending, reimportAllRunning, dialog, router]);

  const list = tab === "pending" ? pending : tab === "confirmed" ? confirmed : ignored;

  // [SEARCH] Live, in-place filter over the loaded list (supplier name / invoice number /
  // whole-euro amount). The page holds the full set (server caps at 100/50), so this is
  // complete — no navigation, no reload.
  // [SMART-FILTER] shared matcher — leverancier / factuurnummer / bedrag
  // (decimaal- én duizendtal-bewust, zie src/lib/search.ts)
  const rawQ = search.trim();
  const filteredList = rawQ
    ? list.filter((inv) =>
        rowMatchesQuery(rawQ, [inv.client_name, inv.invoice_number], [inv.total_inc_btw])
      )
    : list;

  // ── [IMPORT-MONITOR] Two orthogonal facts the header must convey ──────────────
  // HEALTH: "is anything WRONG?"  → invoices the AI/arithmetic flagged.
  // FLOW:   "is anything waiting to be SENT onward?" → every pending invoice
  //          (the upload path holds all in 'processing'; even a clean one needs
  //          one confirming tap to reach the accountant).
  // These are separate. A clean-but-unsent invoice is HEALTHY (no warning) AND
  // waiting-to-flow. Collapsing them into one line is what produced the old
  // dishonesty ("Alles verwerkt" when invoices were in fact still queued, or an
  // alarming "review" on a perfectly clean upload). We keep them apart:
  //   - calm about correctness (don't nag a clean invoice)
  //   - honest about flow (never imply "done" while items wait to be sent)
  const needsAttentionCount = pending.filter(
    (inv) => inv.health.level === "needs-review"
  ).length;
  const readyToConfirmCount = pending.length - needsAttentionCount;

  // [NO-SILENT-EMPTY] One flag, read twice: by the subtitle (which must not say "Alles verwerkt")
  // and by the banner below it (which says WHICH list is short). Both halves are needed — a banner
  // above a line that reads "Alles verwerkt" is a page contradicting itself, and a subtitle that
  // goes quiet without saying why is an owner wondering whether their invoices are gone.
  const loadIncomplete = readFailed.length > 0;

  return (
    <div
      style={{
        // [COLUMN-LADDER] Was a bespoke 430 — the narrowest column in the app,
        // and the furthest from its own loading skeleton, which had always
        // claimed 720: the page snapped 290px narrower the moment it rendered.
        // The four other 430s in this file are BUTTONS and a modal, not columns;
        // they stay. See COLUMN in @/lib/design/tokens.
        maxWidth: COLUMN.work, margin: "0 auto", padding: "0 0 100px",
        // [HEADER-SYSTEM] Was var(--font-sans) (could resolve to a non-Roboto
        // face); now the shared Roboto FONT token, matching the shared bar above.
        fontFamily: FONT,
      }}
    >
      {/* [HEADER-SYSTEM] The title "Inkomend" + back live in the shared sub-page
          bar (DashboardChrome/STATIC_TITLES). This block is now just the status
          subtitle. (Removed a stale comment describing a Logo/Terug header that no
          longer exists here.) */}
      {/* [INCOMING-CHROME] 16px, not 20 — the status line used to start four
          pixels further in than the tabs, the search field and every card below
          it, which is exactly the kind of ragged left edge nobody can name but
          everybody sees. */}
      <div style={{ padding: "20px 16px 0", marginBottom: 14 }}>
        {/* [IMPORT-MONITOR] Two-axis subtitle — calm about correctness, honest
            about flow. Never says "done" while items still wait to be sent. */}
        {/* [NO-SILENT-EMPTY] The empty state comes SECOND. "Alles verwerkt" is a statement about
            the owner's books — every incoming invoice checked and passed on — and a failed read is
            the one condition under which this page knows nothing about that. It used to be the
            first branch, so a queue that could not be read looked exactly like a queue that was
            finished, on the only screen where a 'processing' invoice can be confirmed at all. */}
        {loadIncomplete ? (
          <p style={{ fontSize: 14, color: "#B3261E", margin: "4px 0 0", fontWeight: 600 }}>
            {t('ink.wachtrijOnbekend')}
          </p>
        ) : pending.length === 0 ? (
          <p style={{ fontSize: 14, color: "#5f6368", margin: "4px 0 0" }}>
            {t('ink.allesVerwerkt')}
          </p>
        ) : needsAttentionCount > 0 ? (
          <p style={{ fontSize: 14, color: "#EA8600", margin: "4px 0 0", fontWeight: 600 }}>
            {needsAttentionCount === 1 ? t('ink.kop.aandachtEen') : t('ink.kop.aandachtMeer', { n: needsAttentionCount })}
            {readyToConfirmCount > 0 && (
              <span style={{ color: "#5f6368", fontWeight: 400 }}>
                {" "}· {t('ink.kop.klaarNote', { n: readyToConfirmCount })}
              </span>
            )}
          </p>
        ) : (
          <p style={{ fontSize: 14, color: "#5f6368", margin: "4px 0 0" }}>
            <span style={{ color: M3.success, fontWeight: 600 }}>
              {t('ink.nietsCorrigeren')}
            </span>{" "}
            · {readyToConfirmCount === 1 ? t('ink.kop.klaarEen') : t('ink.kop.klaarMeer', { n: readyToConfirmCount })}
          </p>
        )}
      </div>

      <div style={{ padding: "0 16px" }}>
        {/* ── [NO-SILENT-EMPTY] "We konden niet alles lezen" ───────────────────────────────────
            Above the tabs, because it qualifies all three of them: the counts in the tab labels
            are counts of what LOADED, and a tab whose read failed shows (nothing) exactly like a
            tab that is genuinely empty. The subtitle already refuses to say "Alles verwerkt"; this
            says WHICH list is short and offers the one action that can fix it. Same shape and the
            same two sentences as Crediteuren next door — one screen's way of admitting this must
            not have to be learned twice. */}
        {loadIncomplete && (
          <div role="status" style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12, padding: "12px 14px", borderRadius: 12, border: "1px solid #F5C6C0", background: "#FCE8E6" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: M3.error, flexShrink: 0, marginTop: 1 }} aria-hidden>error</span>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#B3261E", margin: 0, lineHeight: 1.4 }}>
                {/* [TAAL] readFailed holds the server's own Dutch source names — data, shown as-is. */}
                {t('ink.bronnenNietOpgehaald', { sources: readFailed.join(" en ") })}
              </p>
              <p style={{ fontSize: 12.5, color: "#8C1D18", margin: "3px 0 0", lineHeight: 1.45 }}>
                {t('ink.lijstNietCompleet')}
              </p>
              <button
                onClick={() => router.refresh()}
                style={{ marginTop: 8, padding: "7px 14px", borderRadius: 999, border: "none", background: M3.error, color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
              >
                {t('inkoop.opnieuwProberen')}
              </button>
            </div>
          </div>
        )}

        <ConnectEmailCard status={connectionStatus} />

        {/* Tabs */}
        <div
          style={{
            display: "flex", gap: 8, marginBottom: 16,
            background: "#f8f9fa", borderRadius: 12, padding: 4,
          }}
        >
          {([
            ["pending", `${t('ink.tab.teBevestigen')}${pending.length ? ` (${pending.length})` : ""}`],
            ["confirmed", `${t('ink.tab.bevestigd')}${confirmed.length ? ` (${confirmed.length})` : ""}`],
            ["ignored", `${t('bank.genegeerd')}${ignored.length ? ` (${ignored.length})` : ""}`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                setTab(key); setExpandedId(null);
                // [AFZENDERREGEL] Regels pas ophalen als het tabblad waar ze staan open gaat —
                // de wachtrij hoeft er niet op te wachten.
                if (key === "ignored") void loadSenderRules();
              }}
              style={{
                flex: 1, padding: "9px 0", borderRadius: 9, border: "none",
                background: tab === key ? "#fff" : "transparent",
                color: tab === key ? "#202124" : "#5f6368",
                fontWeight: 600, fontSize: 14, cursor: "pointer",
                boxShadow: tab === key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* [SEARCH] In-page live filter (this page only) */}
        {(list.length > 0 || rawQ) && (
          <div style={{ position: "relative", marginBottom: 14 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8e8e93" strokeWidth="2" style={{ position: "absolute", insetInlineStart: 13, top: "50%", transform: "translateY(-50%)" }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('ink.zoek')}
              aria-label={t('ink.zoek.aria')}
              style={{ width: "100%", boxSizing: "border-box", padding: "11px 38px", borderRadius: 12, border: "1px solid #d1d1d6", fontSize: 15, outline: "none", background: "#fff", color: "#1c1c1e" }}
            />
            {search && (
              <button onClick={() => setSearch("")} aria-label={t('ink.zoek.wissen')}
                style={{ position: "absolute", insetInlineEnd: 10, top: "50%", transform: "translateY(-50%)", width: 22, height: 22, borderRadius: "50%", border: "none", background: "#e5e5ea", color: "#3a3a3c", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>✕</button>
            )}
          </div>
        )}

        {/* [INCOMING-CHROME] ONE row for everything that acts on the list, in one
            shape. These three controls used to be scattered down the page in three
            different geometries — an amber rounded-10 box under the status line, a
            blue rounded-10 link under that, and a pill down here — which is most of
            why the top of this page read as a pile rather than a toolbar. Same pill,
            same height, same row; the destination link sits right, away from the
            two that change data. It wraps rather than squeezing on a phone. */}
        <div style={{
          display: "flex", alignItems: "center", flexWrap: "wrap",
          gap: 8, marginBottom: 14,
        }}>
            {tab === "pending" && pending.length > 0 && (!selectMode ? (
              <button
                onClick={() => setSelectMode(true)}
                style={{
                  background: "#e8f0fe", border: "none", color: "#1a73e8",
                  fontWeight: 600, fontSize: 14, cursor: "pointer",
                  padding: "8px 16px", borderRadius: 980, whiteSpace: "nowrap",
                }}
              >
                {t('ink.selecteer')}
              </button>
            ) : (
              <>
                <button
                  onClick={selectAllReady}
                  style={{
                    background: "#e8f0fe", border: "none", color: "#1a73e8",
                    fontWeight: 700, fontSize: 14, cursor: "pointer",
                    padding: "8px 16px", borderRadius: 980, whiteSpace: "nowrap",
                  }}
                >
                  {t('ink.selecteerKlaar', { n: pending.filter((p) => p.health.level !== "needs-review").length })}
                </button>
                <button
                  onClick={exitSelectMode}
                  style={{
                    background: "#f8f9fa", border: "none", color: "#3c4043",
                    fontWeight: 600, fontSize: 14, cursor: "pointer",
                    padding: "8px 16px", borderRadius: 980, whiteSpace: "nowrap",
                  }}
                >
                  {t('ink.annuleer')}
                </button>
              </>
            ))}

            {/* [REIMPORT-ALL] One tap re-reads every "Aandacht nodig" invoice — each keeps its
                own current state (improve-or-keep, never verified). Only on the pending tab and
                only when something is actually flagged. Amber because it belongs to the amber
                badge on those rows, but the same pill as its neighbours. */}
            {tab === "pending" && needsAttentionCount > 0 && (
              <button
                type="button"
                onClick={handleReimportAllNeedsAttention}
                disabled={reimportAllRunning}
                aria-label={t('ink.opnieuwInlezen')}
                style={{
                  background: "#fef7e0", border: "none", color: "#B06000",
                  fontWeight: 600, fontSize: 14,
                  padding: "8px 16px", borderRadius: 980, whiteSpace: "nowrap",
                  cursor: reimportAllRunning ? "default" : "pointer",
                  opacity: reimportAllRunning ? 0.7 : 1,
                }}
              >
                {reimportAllRunning
                  ? t('ink.herleesAlles.voortgang', { n: reimportAllDone, totaal: needsAttentionCount })
                  : t('ink.herleesAlles.knop', { n: needsAttentionCount })}
              </button>
            )}

            {/* [BRIDGE-POLISH 3b] Entry to the management surface for confirmed
                incoming invoices (received/paid). A destination, not an action —
                so it is quiet text at the far end of the row, not a filled pill
                competing with the two controls that change something. */}
            <Link
              href="/dashboard/incoming/manage"
              style={{
                marginInlineStart: "auto", color: "#1a73e8", fontSize: 14, fontWeight: 600,
                textDecoration: "none", whiteSpace: "nowrap", padding: "8px 0",
              }}
            >
              {t('ink.bevestigd')} ›
            </Link>
        </div>

        {/* [RITME] De factuur die NIET kwam. Alleen op het tabblad "Te bevestigen", want daar
            komt de eigenaar om zijn inkomende post af te handelen — en dit is het enige dat hij
            daar NIET kan zien staan. Blauw en rustig, geen alarm: er is niets stuk, er is iets
            afwezig. Wegklikbaar, want een banner die je niet weg kunt krijgen wordt meubilair. */}
        {tab === "pending" && missing.length > 0 && !missingDismissed && (
          <div style={{
            marginBottom: 16, padding: "13px 15px", borderRadius: 12,
            background: "#e8f0fe", border: "1px solid #c6dafc",
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "#174ea6", marginBottom: 6 }}>
                {missing.length === 1
                  ? t('ink.ontbreekt.een')
                  : t('ink.ontbreekt.meer', { n: missing.length })}
              </div>
              <button
                onClick={() => setMissingDismissed(true)}
                aria-label={t('ink.meldingSluiten')}
                style={{
                  background: "transparent", border: "none", color: "#174ea6",
                  fontSize: 16, lineHeight: 1, cursor: "pointer", padding: 0,
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {missing.map((m) => (
                <div key={`${m.supplier}-${m.lastSeen}`} style={{ fontSize: 13, color: "#1f3d68", lineHeight: 1.5 }}>
                  {m.reason}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* [BETAALD-GEEN-STUK] Onder het ritme-paneel, want het is dezelfde vraag met beter bewijs.
            Het ritme ZEGT dat er iets had moeten komen; dit LAAT ZIEN dat het geld weg is en er
            niets aan hangt. Daarom staat het eronder en niet ernaast: wie het leest, leest eerst
            de verwachting en dan de waarneming. */}
        {tab === "pending" && unpaired.length > 0 && !missingDismissed && (
          <div style={{
            marginBottom: 16, padding: "13px 15px", borderRadius: 12,
            background: "#fdf3e7", border: "1px solid #f3d9b6",
          }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "#8a5300", marginBottom: 6 }}>
              {unpaired.length === 1
                ? t('ink.betaaldGeenStuk.een')
                : t('ink.betaaldGeenStuk.meer', { n: unpaired.length })}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {unpaired.slice(0, 6).map((u) => (
                <div key={u.transactionId} style={{ fontSize: 13, color: "#5c3a00", lineHeight: 1.5 }}>
                  {t('ink.betaaldGeenStuk.regel', { bedrag: formatEuroNL(u.amount), leverancier: u.supplier })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* [GELEERD-SINDSDIEN] Bovenaan Genegeerd, want dat is precies de plek waar je kijkt als
            je iets mist. Deze facturen zette de eigenaar opzij toen de lezer ze niet kon lezen; de
            lezer heeft dat sindsdien geleerd, en niemand had hem dat verteld. Het paneel toont
            zichzelf alleen als er iets te bieden is — de genegeerd-lijst is geen plek om gezeurd
            te worden. */}
        {tab === "ignored" && <GeleerdPanel onRestored={() => router.refresh()} />}

        {/* [AFZENDERREGEL] De regels van de eigenaar staan bij Genegeerd, want dat is de plek waar
            je kijkt als je iets mist. Elke regel met het adres erbij en één knop om hem op te
            heffen — een mechanisme dat post ongezien tegenhoudt moet net zo makkelijk uit als aan. */}
        {tab === "ignored" && senderRules.length > 0 && (
          <div style={{
            marginBottom: 16, padding: "12px 14px", borderRadius: 12,
            background: "#f8f9fa", border: "1px solid #e8eaed",
          }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#3c4043", marginBottom: 8 }}>
              {t('ink.afzendersOverslaan')}
            </div>
            <div style={{ fontSize: 12, color: "#5f6368", marginBottom: 10, lineHeight: 1.45 }}>
              {t('ink.regels.uitleg')}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {senderRules.map((r) => (
                <div key={r.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                  padding: "8px 10px", borderRadius: 9, background: "#fff", border: "1px solid #e8eaed",
                }}>
                  <span style={{ fontSize: 13, color: "#202124", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {r.sender_email}
                  </span>
                  <button
                    onClick={() => removeSenderRule(r.sender_email)}
                    style={{
                      background: "transparent", border: "none", color: "#1a73e8",
                      fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", padding: 0,
                    }}
                  >
                    {t('ink.opheffen')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Invoice list */}
        {filteredList.length > 0 ? (
          <div style={{ marginBottom: 24 }}>
            {filteredList.map((inv) => (
              <InvoiceCard
                key={inv.id}
                invoice={inv}
                mode={tab}
                expanded={expandedId === inv.id}
                onToggle={() => setExpandedId(expandedId === inv.id ? null : inv.id)}
                onConfirmPaid={() => setConfirmPaidFor(inv)}
                onEdit={() => setEditFor(inv)}
                onIgnore={() => setIgnoreFor(inv)}
                onRestore={() => handleRestore(inv)}
                selectMode={tab === "pending" && selectMode}
                selected={selected.has(inv.id)}
                onSelect={() => toggleSelect(inv.id)}
                domId={`incoming-card-${inv.id}`}
                highlighted={focusId === inv.id}
                // [READING-MEMORY] Keyed exactly as the server keyed it (trimmed + lowercased), so
                // a supplier written with a trailing space is not treated as a second company.
                readingHint={readingHints[(inv.client_name ?? "").trim().toLowerCase()]}
                suppliers={suppliers}
                suppliersUnavailable={suppliersUnavailable}
              />
            ))}
          </div>
        ) : rawQ ? (
          <div style={{ textAlign: "center", padding: "48px 24px", color: "#8e8e93" }}>
            <div style={{ fontSize: 44, marginBottom: 14 }}>🔍</div>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6, color: "#1c1c1e" }}>{t('ink.leeg')}</div>
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>{tab === "pending" ? t('ink.zoekleeg.pending', { query: rawQ }) : tab === "confirmed" ? t('ink.zoekleeg.confirmed', { query: rawQ }) : t('ink.zoekleeg.ignored', { query: rawQ })}</div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "48px 24px", color: "#5f6368" }}>
            <div style={{ fontSize: 52, marginBottom: 16 }}>
              {tab === "pending" ? "✅" : tab === "confirmed" ? "🗂️" : "📭"}
            </div>
            <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 8, color: "#202124" }}>
              {tab === "pending" ? t('ink.leegtab.pending') : tab === "confirmed" ? t('ink.leegtab.confirmed') : t('ink.leegtab.ignored')}
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>
              {tab === "pending"
                ? t('ink.leegtab.pendingSub')
                : tab === "confirmed"
                  ? t('ink.leegtab.confirmedSub')
                  : t('ink.leegtab.ignoredSub')}
            </div>
          </div>
        )}

        {/* Manual upload — only on pending tab */}
        {tab === "pending" && <ManualUpload onUploaded={() => {}} />}
      </div>

      {/* Confirm-paid modal */}
      {confirmPaidFor && (
        <ConfirmPaidModal
          invoice={confirmPaidFor}
          vendorRate={vendorRates[(confirmPaidFor.client_name ?? "").trim().toLowerCase()]}
          suppliers={suppliers}
          suppliersUnavailable={suppliersUnavailable}
          onVerify={(amounts) => handleVerify(confirmPaidFor, amounts)}
          onPay={(amounts, method, paymentDate) => handlePay(confirmPaidFor, amounts, method, paymentDate)}
          onCancel={() => setConfirmPaidFor(null)}
        />
      )}

      {/* [QUEUE-EDIT-UX] Same modal, edit fields pre-opened — the card's
          "Bewerken" entry point. Save = the normal Bevestig/verifieer flow
          (whoever just corrected the data is ready to confirm it). */}
      {editFor && (
        <ConfirmPaidModal
          invoice={editFor}
          startEditing
          vendorRate={vendorRates[(editFor.client_name ?? "").trim().toLowerCase()]}
          suppliers={suppliers}
          suppliersUnavailable={suppliersUnavailable}
          onVerify={(amounts) => handleVerify(editFor, amounts)}
          onPay={(amounts, method, paymentDate) => handlePay(editFor, amounts, method, paymentDate)}
          onCancel={() => setEditFor(null)}
        />
      )}

      {/* [INTAKE-VERIFY-BULK] Sticky action bar — select mode, ≥1 selected */}
      {tab === "pending" && selectMode && selected.size > 0 && !bulkRunning && !bulkIgnoreRunning && (
        <div
          style={{
            position: "fixed", insetInlineStart: "var(--rail-w)", insetInlineEnd: 0, bottom: 0, zIndex: 1500,
            padding: "12px 16px calc(12px + var(--bottom-nav-h) + env(safe-area-inset-bottom))",
            background: "rgba(255,255,255,0.96)", backdropFilter: "blur(8px)",
            borderTop: "1px solid #e0e0e0",
            display: "flex", justifyContent: "center",
          }}
        >
          {/* [BULK-IGNORE] Twee uitgangen voor dezelfde selectie, in één rij.
              De verhouding is niet cosmetisch. Bevestigen schrijft geld in de boeken en blijft
              daarom de volle, groene, dominante knop; negeren is de smalle nevenknop ernaast. Zo
              kan de duim die naar "bevestig" gaat er niet naast zitten en per ongeluk een stapel
              wegzetten — het omgekeerde risico (per ongeluk bevestigen terwijl je wilde negeren)
              is het gevaarlijke, want dat schrijft wél iets weg. Beide gaan alsnog eerst door een
              bevestigingsdialoog; dit is de tweede laag, niet de enige. */}
          <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 430 }}>
            <button
              onClick={() => setBulkConfirmOpen(true)}
              style={{
                flex: "1 1 auto", minWidth: 0, padding: "16px", borderRadius: 14,
                background: "#34a853", color: "#fff", border: "none",
                fontWeight: 700, fontSize: 16, cursor: "pointer",
              }}
            >
              {selected.size === 1 ? t('ink.bulk.bevestigEen') : t('ink.bulk.bevestigMeer', { n: selected.size })}
            </button>
            <button
              onClick={() => { setBulkIgnoreReason(null); setBulkIgnoreOpen(true); }}
              aria-label={selected.size === 1 ? t('ink.bulk.negeerAriaEen') : t('ink.bulk.negeerAriaMeer', { n: selected.size })}
              style={{
                flex: "0 0 auto", padding: "16px 18px", borderRadius: 14,
                background: "#fce8e6", color: "#c5221f", border: "none",
                fontWeight: 700, fontSize: 16, cursor: "pointer", whiteSpace: "nowrap",
              }}
            >
              {t('ink.bulk.negeerKnop', { n: selected.size })}
            </button>
          </div>
        </div>
      )}

      {/* [INTAKE-VERIFY-BULK] Running overlay */}
      {bulkRunning && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2100 }}>
          <div className="sheet-scroll" style={{ background: "#fff", borderRadius: 16, padding: "24px 28px", fontSize: 15, fontWeight: 600, color: "#202124" }}>
            {t('ink.verifierenBezig')}
          </div>
        </div>
      )}

      {/* [BULK-IGNORE] Zelfde overlay, zelfde reden als bij [REIMPORT-ALL]: de lus loopt per
          factuur, dus zonder blokkade kan er halverwege een kaart worden geopend of bevestigd die
          een tel later alsnog wordt gearchiveerd. De teller staat erbij omdat een stapel van
          twintig merkbaar duurt en een stil scherm dan als vastgelopen leest. */}
      {bulkIgnoreRunning && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2100 }}>
          <div className="sheet-scroll" style={{ background: "#fff", borderRadius: 16, padding: "24px 28px", fontSize: 15, fontWeight: 600, color: "#202124", textAlign: "center" }}>
            {t('ink.negeren.bezig')}
            <div style={{ fontSize: 13, fontWeight: 400, color: "#5f6368", marginTop: 4 }}>
              {bulkIgnoreDone}/{selected.size}
            </div>
          </div>
        </div>
      )}

      {/* [REIMPORT-ALL] Block the page while the batch re-read runs — so an edit modal can't be
          opened mid-run and then wiped by the end-of-run reload, and no card can be verified into
          a 409. */}
      {reimportAllRunning && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2100 }}>
          <div className="sheet-scroll" style={{ background: "#fff", borderRadius: 16, padding: "24px 28px", fontSize: 15, fontWeight: 600, color: "#202124", textAlign: "center" }}>
            {t('ink.opnieuwBezig')}
            <div style={{ fontSize: 13, fontWeight: 400, color: "#5f6368", marginTop: 4 }}>
              {reimportAllDone}/{needsAttentionCount}
            </div>
          </div>
        </div>
      )}

      {/* [INTAKE-VERIFY-BULK] Confirmation modal before the batch runs */}
      {bulkConfirmOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 2000 }}
          onClick={() => setBulkConfirmOpen(false)}
        >
          <div className="sheet-scroll"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: "20px 20px 0 0", padding: "24px 20px",
              paddingBottom: "calc(24px + var(--bottom-nav-h) + env(safe-area-inset-bottom))",
              width: "100%", maxWidth: 430,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 19, color: "#202124", marginBottom: 4 }}>
              {selected.size === 1 ? t('ink.bulk.bevestigVraagEen') : t('ink.bulk.bevestigVraag', { n: selected.size })}
            </div>
            <div style={{ fontSize: 14, color: "#5f6368", marginBottom: 20 }}>
              {t('ink.bulk.bevestigUitleg')}
            </div>
            <button
              onClick={handleVerifyBatch}
              style={{
                width: "100%", padding: "16px", borderRadius: 14,
                background: "#34a853", color: "#fff", border: "none",
                fontWeight: 700, fontSize: 16, cursor: "pointer", marginBottom: 8,
              }}
            >
              Ja, bevestig {selected.size}
            </button>
            <button
              onClick={() => setBulkConfirmOpen(false)}
              style={{
                width: "100%", padding: "14px", borderRadius: 14,
                background: "#f8f9fa", color: "#202124", border: "none",
                fontWeight: 600, fontSize: 15, cursor: "pointer",
              }}
            >
              {t('ink.annuleren')}
            </button>
          </div>
        </div>
      )}

      {/* [AFZENDERREGEL] Het aanbod, ná het negeren. Bewust een apart schermpje en geen vinkje in
          de negeer-dialoog: een blijvende regel die post tegenhoudt verdient een eigen ja, niet
          een vakje dat je per ongeluk meeneemt terwijl je iets anders aan het doen was. */}
      {ruleOfferFor && (
        <ConfirmDialog
          title={t('ink.negeren.altijd')}
          message={t('ink.regels.aanbod', { email: ruleOfferFor.client_email ?? '' })}
          confirmLabel={t('ink.regels.aanbodBevestig')}
          confirmColor="#1a73e8"
          onConfirm={() => addSenderRule(ruleOfferFor)}
          onCancel={() => setRuleOfferFor(null)}
        />
      )}

      {/* [BULK-IGNORE] Bevestiging vóór de stapel. Dezelfde dialoog en dezelfde redenenlijst als
          bij één factuur — één vorm voor één handeling, of het er nu één of twintig zijn. De reden
          is ook hier vrijwillig: wie twintig reclamemails wegzet weet waarom, wie twijfelt hoeft
          niets in te vullen. */}
      {bulkIgnoreOpen && selected.size > 0 && (
        <ConfirmDialog
          title={selected.size === 1 ? t('ink.bulk.negerenVraagEen') : t('ink.bulk.negerenVraag', { n: selected.size })}
          message={t('ink.bulk.negerenUitleg')}
          confirmLabel={t('ink.bulk.negerenBevestig', { n: selected.size })}
          confirmColor="#ea4335"
          choices={ARCHIVE_REASONS.map((v) => ({
            value: v,
            label: ARCHIVE_REASON_LABELS[v].label,
            hint: ARCHIVE_REASON_LABELS[v].hint,
          }))}
          choiceValue={bulkIgnoreReason}
          onChoice={(v) => setBulkIgnoreReason(v as ArchiveReason | null)}
          onConfirm={handleIgnoreBatch}
          onCancel={() => { setBulkIgnoreOpen(false); setBulkIgnoreReason(null); }}
        />
      )}

      {/* Ignore confirmation */}
      {ignoreFor && (
        <ConfirmDialog
          title={t('ink.negeren.titel')}
          message={t('ink.negeren.uitleg')}
          confirmLabel={t('ink.negeren.bevestig')}
          confirmColor="#ea4335"
          choices={ARCHIVE_REASONS.map((v) => ({
            value: v,
            label: ARCHIVE_REASON_LABELS[v].label,
            hint: ARCHIVE_REASON_LABELS[v].hint,
          }))}
          choiceValue={ignoreReason}
          onChoice={(v) => setIgnoreReason(v as ArchiveReason | null)}
          onConfirm={() => handleIgnore(ignoreFor, ignoreReason)}
          onCancel={() => { setIgnoreFor(null); setIgnoreReason(null); }}
        />
      )}

      {/* Toast */}
    </div>
  );
}