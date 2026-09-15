// src/app/dashboard/vandaag/VandaagClient.tsx
// [TODAY-LISTS-V1 + TODAY-UX-CLARITY] "Vandaag" client — the owner's daily
// control center for invoices. Shows TASKS + DATES only, never a computed
// amount/total (locked principle: a wrong number breaks trust; a wrong task is
// just ignored).
//
// [TODAY-UX-CLARITY] Clarity pass — the card now answers the two questions the
// owner actually has ("why is this in front of me?" / "what do I do?"):
//   1. Urgency: every overdue invoice shows the real day count ("36 dagen te
//      laat" — owner decision; the earlier calm "Al lang open" label hid the
//      number), rendered red, in ONE flat list sorted by the chosen order.
//   2. "Al betaald?" context action — jumps to the manage surface to confirm
//      (Vandaag stays READ-ONLY; the write happens where the logic already lives).
//   3. One clear primary verb per direction ("Betalen" / "Herinnering") instead
//      of the ambiguous "Bekijk / betaal".
//   4. "Negeren" reads as "verbergen voor vandaag" (hide), not "delete".
//   5. Section header shows a count ("1 factuur") for a sense of control.
//
// Payment state is `status` ONLY (never payment_date/marked_paid_at). Direction-
// aware navigation: incoming → IncomingManageClient (?focus=), outgoing → invoice
// detail. Design: Material You (ZZP surface), mobile-first. All copy in Dutch.

"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
// [TODAY-UX-FIELDS] Display-only formatters (single source of truth). formatEuroNL
// simply RENDERS a stored number; no arithmetic happens in "Vandaag".
import { formatEuroNL, formatDateNL, amsterdamToday } from "@/lib/format-nl";
// [CREDIT-TERUG] The creditnotas that still owe the customer money — decided in the pure rule.
import type { RefundableCredit } from "@/lib/credited-invoices";
import { FONT, COLUMN } from "@/lib/design/tokens";
import { rowMatchesQuery } from "@/lib/search";
// [SORT] Same ordering module as Inkoopfacturen (IncomingManageClient) — one
// implementation, no drifting copies. Vandaag offers the subset of keys whose
// columns it actually selects (no created_at / payment_date here).
import { sortRows, SORTS, type SortKey } from "@/lib/invoice-sort";
// [DESIGN] Palette and radius come from the shared source now
// (src/lib/design/tokens.ts). This file used to declare its own copy; see the
// header of tokens.ts for why the copies had to go — two of the values in them
// were below the contrast floor for text.
import { M3 } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
// [PAY-REDEN] One rule for what a refused pay-toggle says, shared with /facturen and /manage.
import { payToggleAnswer, isDuplicatePaidConflict, PAY_TOGGLE_FALLBACK_KEY } from '@/lib/pay-toggle-reason'
import { useDialog } from "@/components/ui/Dialog";
// [BTW-RESERVERING] Het geld op de rekening dat al van de Belastingdienst is.
import BtwReservationPanel from '@/components/btw/BtwReservationPanel'
import CashflowPanel from '@/components/cashflow/CashflowPanel'
// [BEVEILIGING] Zie de kop van dat bestand: hij rendert niets zodra de tweede stap aanstaat.
import { TweestapsHint } from '@/components/beveiliging/TweestapsHint'
import { selfShare, type SelfShareCounts } from '@/lib/zelfstandig'
import type { WorkCounts, WorkSignal } from '@/lib/werk'
import { werkZin as werkZinPure, werkSignaalZin as werkSignaalZinPure } from '@/lib/werk-stand-copy'
import Link from 'next/link'

// ─── Material You tokens (matched 1:1 with IncomingManageClient) ──────────────


// [OWNER-DECISION] The old 30-day "Al langer open" tier (separate calm-amber
// group rendered BELOW the active items) is gone: with real day counts on the
// cards it read as a sorting bug — "36 dagen te laat" listed after "10 dagen
// te laat". One flat list in the chosen order, and every overdue row is red.

// ─── Types ──────────────────────────────────────────────────────────────────

/** [OFFERTE-OPVOLGING] Een offerte met het oordeel van de pure regel erbij. */
export interface VandaagOfferte extends VandaagInvoice {
  followupState: "geaccepteerd" | "verloopt-binnenkort" | "verlopen";
  /** Dagen tot "Geldig tot". Negatief = al verlopen. */
  followupDays: number;
}

export interface VandaagInvoice {
  id: string;
  client_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null; // ISO date
  due_date: string | null; // ISO date — page.tsx already filters out nulls
  total_inc_btw: number | null; // STORED total — read-only, never computed here
  amount_paid?: number | null; // [PARTIAL-PAY] settled so far; remaining = |total| − amount_paid
  status: string;
  direction: string;
}

interface Props {
  payable: VandaagInvoice[]; // List 1 — incoming, status='received'
  remind: VandaagInvoice[]; // List 2 — outgoing, status IN ('sent','overdue')
  // [OFFERTE-OPVOLGING] List 3 — verstuurde offertes die bijna of al verlopen zijn. Alleen de
  // rijen die volgens offerte-followup.ts aandacht vragen; de rest komt hier niet eens aan.
  offertes?: VandaagOfferte[];
  /** [CREDIT-TERUG] List 4 — creditnotas still to refund; null when that read failed (then said). */
  refunds?: RefundableCredit[] | null;
  loadFailed?: boolean; // [COHERENCE-ERRSTATE] true when a server query errored
  toVerifyCount?: number; // [P1-STUCK-PROCESSING] incoming invoices stuck in the verify queue
  datelessPayableCount?: number; // [DATELESS-TASK] confirmed incoming bills with no due date (else invisible)
  /** [ZIEL] This week's self/hand counts and what waits; null when the read failed (then nothing is said). */
  zelf?: SelfShareCounts | null;
  /** [WERK] The trade's own counts and plural; null for a trade without a work layer or a failed read. */
  werk?: { pluralKey: string; counts: WorkCounts; signals?: WorkSignal[] } | null;
}

/** [WERK] One sentence in the trade's own word — from werk-stand-copy.ts, shared with the Werk screen. */
export function werkZin(werk: { pluralKey: string; counts: WorkCounts } | null | undefined, t: (k: string, v?: Record<string, string | number>) => string): string | null {
  return werkZinPure(werk, t);
}

/** [WERK-4] One sentence per signal, and where to tap — from werk-stand-copy.ts. */
export function werkSignaalZin(s: WorkSignal, t: (k: string, v?: Record<string, string | number>) => string): { text: string; href: string } {
  return werkSignaalZinPure(s, t);
}

/** [ZIEL] One sentence: what the app did by itself this week, and what waits. Pure. */
export function zelfZin(counts: SelfShareCounts | null | undefined, t: (k: string, v?: Record<string, string | number>) => string): string | null {
  if (!counts) return null;
  const z = selfShare(counts);
  if (z.share === null) return z.waiting > 0 ? (z.waiting === 1 ? t('vandaag.zelf.wachtEen') : t('vandaag.zelf.wachtMeer', { n: z.waiting })) : null;
  const deed = t('vandaag.zelf.deed', { self: z.self, total: z.total });
  const wait = z.waiting === 0 ? t('vandaag.zelf.niets') : z.waiting === 1 ? t('vandaag.zelf.wachtEen') : t('vandaag.zelf.wachtMeer', { n: z.waiting });
  return `${deed} ${wait}`;
}

// ─── Date helpers (timezone-proof) ────────────────────────────────────────────
// Mirrors lib/format-nl.ts: a date-only string ("2026-06-12") is handled by
// STRING surgery, never `new Date('2026-06-12')` (which parses as UTC midnight and
// shifts a day in negative-offset zones). We compare whole calendar days only.

function todayDayNumber(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // "YYYY-MM-DD"
  return dayNumberFromIso(parts);
}

// Convert an ISO date prefix ("YYYY-MM-DD…") to a whole-day count via UTC noon.
// UTC noon is safe: no DST/offset can push a date-only value across midnight.
function dayNumberFromIso(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return NaN;
  const utc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  return Math.floor(utc / 86_400_000);
}

// Days until due: negative = overdue, 0 = today, positive = future.
function daysUntilDue(dueIso: string): number {
  return dayNumberFromIso(dueIso) - todayDayNumber();
}

// Urgency tier drives BOTH the label and the colour, so they can never disagree.
type Urgency = "overdue" | "soon";

function urgencyOf(dueIso: string): Urgency {
  return daysUntilDue(dueIso) < 0 ? "overdue" : "soon";
}

// Human due-date status. [OWNER-DECISION] Every overdue invoice shows the
// real day count ("36 dagen te laat") — no calm tier, no grouping.
// [TAAL] Takes the caller's translator; each count band has its own key.
function dueLabel(dueIso: string, t: ReturnType<typeof translator>): string {
  const d = daysUntilDue(dueIso);
  if (d < 0) {
    const late = Math.abs(d);
    return late === 1 ? t('vandaag.telaatEen') : t('vandaag.telaatMeer', { n: late });
  }
  if (d === 0) return t('vandaag.vervaltVandaag');
  if (d === 1) return t('vandaag.vervaltMorgen');
  return t('vandaag.vervaltOver', { n: d });
}

// Red for ANY overdue invoice, amber for soon-due. (The old scheme colored a
// 30+-days-late row CALMER than a 10-days-late one — indefensible once both
// sit in one flat list showing real day counts.)
function accentOf(dueIso: string): string {
  return urgencyOf(dueIso) === "overdue" ? M3.error : M3.warning;
}

// [SORT] Keys Vandaag can honour: the page's SELECT has no created_at and its
// rows are unpaid (payment_date is meaningless), so 'added_desc'/'paydate_desc'
// are excluded. Default 'due_asc' = the page's historical order (oldest due
// first), so nothing changes until the owner picks another order.
const VANDAAG_SORT_KEYS: SortKey[] = [
  "due_asc", "invdate_desc", "invdate_asc", "amount_desc", "amount_asc", "vendor_asc",
];
const VANDAAG_SORTS = SORTS.filter((s) => VANDAAG_SORT_KEYS.includes(s.id));

// ─── Component ────────────────────────────────────────────────────────────────

export default function VandaagClient({ payable, remind, offertes = [], refunds = [], loadFailed, toVerifyCount = 0, datelessPayableCount = 0, zelf = null, werk = null }: Props) {
  const t = translator(useLocale())
  const router = useRouter();
  // [HAND-DUBBEL] De app-brede bevestigingsdialoog (DialogProvider staat in de root layout).
  const dialog = useDialog();

  // [TODAY-LISTS-V1] "Negeren" = session-only visual hide (no DB write, like
  // BANK-SLOT-DISMISS). The invoice is untouched; it returns on reload because it
  // is still unpaid — intended (a reminder, not a deletion).
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const dismiss = (id: string) =>
    setDismissed((prev: Set<string>) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });

  // [TODAY-ROUTE-FIX] Direction-aware navigation. Incoming → the complete manage
  // surface (PDF, PAY-SAFE/QR, vendor details), landing on the exact row via
  // ?focus=. Outgoing → the invoice detail page (creditnota, actions). We never
  // send an incoming invoice to the detail page (it renders incoming incompletely).
  const open = (id: string, direction: string) =>
    router.push(
      direction === "incoming"
        ? `/dashboard/incoming/manage?focus=${id}`
        : `/dashboard/invoice/${id}`
    );

  // [VANDAAG-DOEN] "Al betaald?" — nu HIER, in plaats van een reis naar een ander scherm.
  //
  // WAAROM DIT VERANDERDE
  // Deze pagina had vier knoppen en alle vier brachten je ergens anders heen. Hij las daardoor als
  // een lijst waar je naar kijkt in plaats van een werkblad waarop je werkt: 89 inkoopfacturen,
  // EUR 58.000 te betalen, en geen enkele handeling die je hier kon afmaken.
  //
  // De oude regel hierboven — "Vandaag stays READ-ONLY, one source of truth" — verwarde twee
  // dingen. Eén bron van waarheid gaat over de SCHRIJVER, niet over het SCHERM. Die schrijver is
  // /api/invoice/pay-toggle: server-authoritative, geaudit, en het ongedaan maken koppelt ook de
  // banktransactie los. Dat blijft precies zo. Alleen roept deze pagina hem nu zelf aan, in plaats
  // van de eigenaar erheen te sturen om dezelfde knop daar te vinden.
  //
  // WAT HIER NADRUKKELIJK NIET KAN
  // Een deelbetaling, of een andere datum dan vandaag. Dat zijn de gevallen waarin het bedrag of
  // het moment ter discussie staat, en die horen op het scherm dat ze volledig kan tonen — de link
  // ernaast blijft er dus staan. Deze knop doet alleen het geval dat de eigenaar tientallen keren
  // per kwartaal heeft: die is helemaal betaald, vandaag, van de bank.
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState<string | null>(null);
  const [payError, setPayError] = useState<Record<string, string>>({});
  const [paidIds, setPaidIds] = useState<Set<string>>(new Set());

  const confirmPaid = (id: string) => setPayingId((cur) => (cur === id ? null : id));

  // [NAV-FROM] &from=vandaag zodat Terug op het beheerscherm hier terugkomt, niet in de
  // verificatielijst die deze bezoeker nooit opende.
  const openFullPayDialog = (id: string) =>
    router.push(`/dashboard/incoming/manage?focus=${id}&action=pay&from=vandaag`);

  const payNow = useCallback(async (id: string, paymentMethod: "bank" | "kas") => {
    setPayBusy(id);
    setPayError((e) => ({ ...e, [id]: "" }));
    // [HAND-DUBBEL] De verzending zelf, zodat een tweede ronde met `force` dezelfde regels
    // doorloopt in plaats van een tweede, iets andere kopie ervan. Binnen de useCallback en niet
    // als recursie op payNow: een callback die zichzelf aanroept moet in zijn eigen dependencies
    // staan, en dat is een lus die niemand later nog durft aan te raken.
    const verstuur = async (force: boolean): Promise<void> => {
      const res = await fetch("/api/invoice/pay-toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: id,
          action: "pay",
          paymentMethod,
          paymentDate: amsterdamToday(),
          ...(force ? { force: true } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // [PAY-REDEN] This used to be `throw new Error(data?.error || …)` — the machine CODE. A
        // shop owner tapping "Al betaald?" read "invoice_already_paid" under the button, in every
        // language including Dutch, for every refusal this route can make. One shared rule now
        // decides (pay-toggle-reason.ts): the server's own sentence when it wrote one and the
        // status says we may trust it, otherwise a line from the catalogue in the owner's
        // language. Never a code.
        const answer = payToggleAnswer(res.status, data);
        const bericht = answer.kind === "server" ? answer.text : t(answer.key);
        // [HAND-DUBBEL] Dit factuurnummer staat al ergens anders betaald. Dat is geen storing en
        // geen verbod: welke van twee lezingen de echte factuur is, is een vraag over papier — en
        // op het Enka-paar was de kopie die ons goed leek juist de verkeerde. Dus vragen, en bij ja
        // dezelfde verzending nog één keer met force.
        //
        // Ook op dit scherm, en niet alleen op het beheerscherm: de dubbele boekingen in de live
        // administratie zijn met één tik gemaakt, en dit is het scherm waar die tik het snelst gaat.
        if (isDuplicatePaidConflict(data)) {
          const toch = await dialog.confirm({
            title: t("ink.dubbelBetaald.kop"),
            message: bericht,
            confirmLabel: t("ink.dubbelBetaald.tochBoeken"),
          });
          if (toch) return verstuur(true);
          // Nee is een antwoord, en het hoort te blijven staan: de regel houdt de zin die uitlegt
          // waarom er niets is geboekt.
          setPayError((e) => ({ ...e, [id]: bericht }));
          return;
        }
        setPayError((e) => ({ ...e, [id]: bericht }));
        return;
      }
      setPaidIds((prev) => new Set(prev).add(id));
      setPayingId(null);
    };

    try {
      await verstuur(false);
    } catch {
      // The request never completed — it may or may not have reached the server, and we cannot
      // know which. The catalogue's neutral line says exactly that much and nothing more.
      setPayError((e) => ({ ...e, [id]: t(PAY_TOGGLE_FALLBACK_KEY) }));
    } finally {
      setPayBusy(null);
    }
  }, [t, dialog]);

  // [SORT] Owner-chosen order, applied inside each list.
  const [sortBy, setSortBy] = useState<SortKey>("due_asc");
  const [showSortMenu, setShowSortMenu] = useState(false);

  const visiblePayable = useMemo(
    () => filterWindow(payable, dismissed, sortBy),
    [payable, dismissed, sortBy]
  );
  const visibleRemind = useMemo(
    () => filterWindow(remind, dismissed, sortBy),
    [remind, dismissed, sortBy]
  );

  // [OFFERTE-OPVOLGING] Een offerte die verloopt is óók iets te doen. Zonder dit zou het scherm
  // "niets te doen" zeggen terwijl er drie offertes koud staan te worden — precies de valse
  // geruststelling die deze pagina nergens mag geven.
  const zichtbareOffertes = offertes.filter((o) => !dismissed.has(o.id));
  // [CREDIT-TERUG] A failed read is not an empty list: it keeps the section, which then says so.
  const refundsUnknown = refunds === null;
  const zichtbareRefunds = (refunds ?? []).filter((r) => !dismissed.has(r.id));
  const nothingToDo =
    visiblePayable.length === 0 && visibleRemind.length === 0 && zichtbareOffertes.length === 0
    && zichtbareRefunds.length === 0 && !refundsUnknown;

  // [SEARCH] In-page live filter. Smart: while searching it WIDENS beyond today's
  // 3-day window to the full payable/remind sets (minus dismissed), so you can find
  // any invoice this page tracks — in place, no navigation.
  const [search, setSearch] = useState("");
  const rawV = search.trim();
  // [SMART-FILTER] shared matcher — klant / factuurnummer / bedrag
  // (decimaal- én duizendtal-bewust, zie src/lib/search.ts)
  // [PERF] useCallback houdt de matcher stabiel per zoekterm, zodat de memo's hieronder
  // niet bij elke render opnieuw filteren.
  const matchV = useCallback(
    (inv: VandaagInvoice) =>
      rowMatchesQuery(rawV, [inv.client_name, inv.invoice_number], [inv.total_inc_btw]),
    [rawV]
  );
  const searching = rawV.length > 0;
  const canSearch = payable.length > 0 || remind.length > 0;
  // [SORT] Search results honour the chosen order too.
  // [PERF] useMemo: alleen herberekenen als de zoekterm, de lijsten, de verborgen items,
  // de sortering of het 3-daagse venster wijzigen.
  const displayPayable = useMemo(
    () => (searching ? sortRows(payable.filter((i) => !dismissed.has(i.id) && matchV(i)), sortBy) : visiblePayable),
    [searching, payable, dismissed, matchV, sortBy, visiblePayable]
  );
  const displayRemind = useMemo(
    () => (searching ? sortRows(remind.filter((i) => !dismissed.has(i.id) && matchV(i)), sortBy) : visibleRemind),
    [searching, remind, dismissed, matchV, sortBy, visibleRemind]
  );
  const noneShown = displayPayable.length === 0 && displayRemind.length === 0;

  return (
    <div
      style={{
        maxWidth: COLUMN.work,
        margin: "0 auto",
        padding: "24px 16px 64px",
        // [HEADER-SYSTEM] Was a bespoke system-ui font stack (the only one in the
        // app); now the shared Roboto FONT token.
        fontFamily: FONT,
      }}
    >
      {/* [HEADER-SYSTEM] Title "Vandaag" + back live in the shared sub-page bar;
          the in-body h1 was removed. The one-line subtitle stays. */}
      <header style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 15, color: M3.onSurfaceVariant, margin: 0 }}>
          {t('vandaag.aandacht')}
        </p>
        {/* [ZIEL] The equation, measured: what BoekBrug did by itself this week, what waits. One
            line, from the audit trail, absent when nothing was booked or the read failed. */}
        {zelfZin(zelf, t as (k: string, v?: Record<string, string | number>) => string) && (
          <p style={{ fontSize: 13, color: M3.onSurfaceVariant, margin: '6px 0 0' }}>
            {zelfZin(zelf, t as (k: string, v?: Record<string, string | number>) => string)}
          </p>
        )}
        {/* [WERK] The trade's day first, in its own word — a mechanic reads "Werkorders: 2 klaar
            voor de factuur" before any invoice. One line, one link, absent for other trades. */}
        {werkZin(werk, t as (k: string, v?: Record<string, string | number>) => string) && werk && (
          <p style={{ fontSize: 13, color: M3.onSurfaceVariant, margin: '6px 0 0' }}>
            {werkZin(werk, t as (k: string, v?: Record<string, string | number>) => string)}{' '}
            <Link href="/dashboard/werk" style={{ color: M3.primary, fontWeight: 600, textDecoration: 'none' }}>
              {t('vandaag.werk.naar', { plural: t(werk.pluralKey as Parameters<typeof t>[0]) })} →
            </Link>
          </p>
        )}
        {/* [WERK-4] What is sitting between the work and the invoice — one line each, each a link. */}
        {werk && (werk.signals ?? []).length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="werk-signalen">
            {(werk.signals ?? []).map((s) => {
              const z = werkSignaalZin(s, t as (k: string, v?: Record<string, string | number>) => string)
              return (
                <li key={s.kind} style={{ fontSize: 13, color: '#7A4B00' }}>
                  ⚠ {z.text} <Link href={z.href} style={{ color: M3.primary, fontWeight: 600, textDecoration: 'none' }}>→</Link>
                </li>
              )
            })}
          </ul>
        )}
      </header>

      {/* [BEVEILIGING] Alleen zichtbaar zolang de tweede stap UIT staat, en weg zodra hij aanstaat.
          Geen wegklikbare banner: dit is levende toestand, dus er valt niets te onthouden en hij kan
          niet blijven staan nadat het feit dat hij noemt niet meer waar is. Op dit scherm omdat een
          eigenaar die het tegeltje nooit opent, anders nooit hoort dat het slot bestaat. */}
      <TweestapsHint />

      {/* [BTW-RESERVERING] Wat er van het saldo al van de Belastingdienst is.
          Boven de lijsten, want het verandert wat de rest betekent: "€ 3.000 te ontvangen" leest
          heel anders naast "€ 2.100 daarvan is btw". Het paneel haalt zijn eigen cijfer op ná de
          eerste render (zie de component) en toont niets tot het iets te zeggen heeft — dit scherm
          blijft dus even snel als het [WATERVAL] werk het maakte. */}
      <BtwReservationPanel />

      {/* [VOORUIT] Hoeveel geld er over 7 en over 30 dagen is. Direct onder de btw-reservering,
          omdat de twee samen de vraag beantwoorden waar dit scherm voor is: kom ik uit? Zelfde
          patroon: haalt zijn cijfer op ná de eerste render en toont niets tot het iets waars heeft. */}
      <CashflowPanel />

      {/* [P1-STUCK-PROCESSING] Nudge for invoices imported/photographed but not yet verified.
          Ambiguous ones stay in the verify queue with no reminder and their cost + BTW-aftrek
          never reach the books — so surface them here, on the daily control center. Shown even
          when the payment lists are empty (an empty "all clear" while N invoices wait is a lie). */}
      {!loadFailed && toVerifyCount > 0 && (
        <button
          onClick={() => router.push("/dashboard/incoming")}
          style={{
            width: "100%", textAlign: "start", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 12,
            background: "#FEF7E0", border: `1px solid #FBBC04`, borderRadius: 16,
            padding: "14px 16px", marginBottom: 16,
          }}
        >
          <span style={{ fontSize: 22 }}>📥</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: "#7A4F00" }}>
              {toVerifyCount === 1 ? t('vandaag.verificatieEen') : t('vandaag.verificatieMeer', { n: toVerifyCount })}
            </span>
            <span style={{ display: "block", fontSize: 13, color: "#7A4F00", marginTop: 1 }}>
              {t('vandaag.controleerKosten')}
            </span>
          </span>
          <span className="material-symbols-outlined icon-dir" style={{ fontSize: 20, color: "#B06000" }} aria-hidden>chevron_right</span>
        </button>
      )}

      {/* [DATELESS-TASK] Confirmed bills with no due date are excluded from the date-sorted "Te
          betalen" list, so without this they'd sit on no task list at all. Surface them so a cost
          the owner still owes can never be silently forgotten behind an empty "all clear". */}
      {!loadFailed && datelessPayableCount > 0 && (
        <button
          onClick={() => router.push("/dashboard/incoming/manage?from=vandaag")}
          style={{
            width: "100%", textAlign: "start", cursor: "pointer",
            display: "flex", alignItems: "center", gap: 12,
            background: "#FEF7E0", border: `1px solid #FBBC04`, borderRadius: 16,
            padding: "14px 16px", marginBottom: 16,
          }}
        >
          <span style={{ fontSize: 22 }}>📅</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: "#7A4F00" }}>
              {datelessPayableCount === 1 ? t('vandaag.zonderVervalEen') : t('vandaag.zonderVervalMeer', { n: datelessPayableCount })}
            </span>
            <span style={{ display: "block", fontSize: 13, color: "#7A4F00", marginTop: 1 }}>
              {t('vandaag.geenBetaallijst')}
            </span>
          </span>
          <span className="material-symbols-outlined icon-dir" style={{ fontSize: 20, color: "#B06000" }} aria-hidden>chevron_right</span>
        </button>
      )}

      {/* [SEARCH] In-page live filter — widens beyond today's window while searching */}
      {!loadFailed && canSearch && (
        <div style={{ position: "relative", marginBottom: 16 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa0a6" strokeWidth="2" style={{ position: "absolute", insetInlineStart: 13, top: "50%", transform: "translateY(-50%)" }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('lijst.zoek')}
            aria-label={t('lijst.zoek.aria')}
            style={{ width: "100%", boxSizing: "border-box", padding: "11px 38px", borderRadius: 12, border: "1px solid #d1d1d6", fontSize: 15, outline: "none", background: "#fff", color: "#1c1c1e" }}
          />
          {search && (
            <button onClick={() => setSearch("")} aria-label={t('inkoop.wissen')} className="tap-44"
              style={{ position: "absolute", insetInlineEnd: 10, top: "50%", transform: "translateY(-50%)", width: 22, height: 22, borderRadius: "50%", border: "none", background: "#e5e5ea", color: "#3a3a3c", cursor: "pointer", fontSize: 13, lineHeight: 1 }}>×</button>
          )}
        </div>
      )}

      {/* [SORT] Sorteren op — same options/module as Inkoopfacturen. Inline SVG
          icon (never the icon font, which renders as raw text when it fails to
          load). Default 'due_asc' keeps the page's historical order. */}
      {!loadFailed && canSearch && (
        <div style={{ position: "relative", marginBottom: 16 }}>
          <button
            onClick={() => setShowSortMenu((p) => !p)}
            title={t('inkoop.sorteren')}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, width: "100%", padding: "10px 14px", background: "#F1F3F4", borderRadius: 12, border: "none", cursor: "pointer", fontFamily: "inherit" }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#49454F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M7 4v13M7 17l-3-3M7 17l3-3" /><path d="M17 20V7M17 7l-3 3M17 7l3 3" />
              </svg>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#49454F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t(VANDAAG_SORTS.find((s) => s.id === sortBy)?.label ?? 'inkoop.sorteren')}
              </span>
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#49454F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: showSortMenu ? "rotate(180deg)" : "none" }}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {showSortMenu && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100, background: "#fff", borderRadius: 12, marginTop: 4, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", overflow: "hidden" }}>
              {VANDAAG_SORTS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { setSortBy(s.id); setShowSortMenu(false); }}
                  style={{ display: "block", width: "100%", padding: "12px 16px", textAlign: "start", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: sortBy === s.id ? 600 : 400, background: sortBy === s.id ? "#D3E3FD" : "#fff", color: sortBy === s.id ? "#041E49" : M3.onSurface, borderBottom: "0.5px solid #F1F3F4" }}
                >
                  {t(s.label)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {loadFailed ? (
        <LoadError onRetry={() => router.refresh()} />
      ) : searching ? (
        noneShown ? (
          <p style={{ textAlign: "center", color: "#8e8e93", fontSize: 14, padding: "40px 16px" }}>
            Geen facturen gevonden voor &ldquo;{rawV}&rdquo;.
          </p>
        ) : (
          <>
            <ListSection title={t('vandaag.teBetalen')} subtitle={t('vandaag.jijBetalen')}
              invoices={displayPayable} onOpen={open} onConfirmPaid={confirmPaid} onDismiss={dismiss} payingId={payingId} payBusyId={payBusy} paidIds={paidIds} payError={payError} onPayNow={payNow} onOpenFullPay={openFullPayDialog} />
            <ListSection title={t('vandaag.herinner')} subtitle={t('vandaag.onbetaald')}
              invoices={displayRemind} onOpen={open} onConfirmPaid={null} onDismiss={dismiss} />
          </>
        )
      ) : nothingToDo && toVerifyCount === 0 && datelessPayableCount === 0 ? (
        <EmptyAllClear />
      ) : nothingToDo ? null : (
        <>
          <ListSection
            title={t('vandaag.teBetalen')}
            subtitle={t('vandaag.jijBetalen')}
            invoices={visiblePayable}
            onOpen={open}
            onConfirmPaid={confirmPaid}
            payingId={payingId}
            payBusyId={payBusy}
            paidIds={paidIds}
            payError={payError}
            onPayNow={payNow}
            onOpenFullPay={openFullPayDialog}
            onDismiss={dismiss}
          />
          <ListSection
            title={t('vandaag.herinner')}
            subtitle={t('vandaag.onbetaald')}
            invoices={visibleRemind}
            onOpen={open}
            onConfirmPaid={null}
            onDismiss={dismiss}
          />
          {/* [OFFERTE-OPVOLGING] Een eigen sectie, en met opzet geen InvoiceCard: die kaart gaat
              helemaal over betalen — "te laat", een Betalen-knop, een openstaand bedrag. Op een
              offerte klopt geen van die woorden. Hier gaat het om één ding: hier ligt werk dat je
              nog kunt winnen, en de tijd loopt. */}
          {zichtbareOffertes.length > 0 && (
            <OfferteSection offertes={zichtbareOffertes} onOpen={open} onDismiss={dismiss} />
          )}
          {/* [CREDIT-TERUG] Money the owner OWES: a creditnota against a paid invoice. Its own
              section for the same reason the offertes have one — nothing on the invoice card
              (Betalen, "te laat", an open amount) is a word that fits a refund. The button goes to
              the sales list, on the row, where "Voldaan!" records the refund. */}
          {(zichtbareRefunds.length > 0 || refundsUnknown) && (
            <RefundSection refunds={zichtbareRefunds} unknown={refundsUnknown} onOpen={(id) => router.push(`/dashboard/facturen?focus=${id}`)} onDismiss={dismiss} />
          )}
        </>
      )}
    </div>
  );
}

// Keep only invoices due within 3 days (or overdue) and not session-dismissed,
// in the owner-chosen order (default: oldest-due first — the page's historical
// behaviour). Defensive null-guard on due_date (page.tsx excludes nulls).
function filterWindow(
  invoices: VandaagInvoice[],
  dismissed: Set<string>,
  sortBy: SortKey
): VandaagInvoice[] {
  return sortRows(
    invoices
      .filter((inv) => inv.due_date && !dismissed.has(inv.id))
      .filter((inv) => daysUntilDue(inv.due_date as string) <= 3),
    sortBy
  );
}

// ─── List section ─────────────────────────────────────────────────────────────
// [TODAY-UX-CLARITY] header shows a count; one flat list in the chosen order.

/**
 * [OFFERTE-OPVOLGING] De offertes die aandacht vragen.
 *
 * Bewust kaal: naam, nummer, bedrag, en hoeveel tijd er nog is. Geen bedrag-openstaand, geen
 * betaalknop, geen "te laat" — een offerte is geen schuld en die woorden zouden er een van maken
 * op het scherm waar de ondernemer zijn dag mee begint.
 *
 * En geen enkele knop die iets AAN de klant doet. Opvolgen is een verkoopgesprek; de app wijst
 * aan, de mens belt. Zie de kop van offerte-followup.ts.
 */
function OfferteSection({
  offertes,
  onOpen,
  onDismiss,
}: {
  offertes: VandaagOfferte[];
  // Dezelfde open() als de andere secties: hij wil de richting erbij om de juiste pagina te kiezen.
  onOpen: (id: string, direction: string) => void;
  onDismiss: (id: string) => void;
}) {
  const t = translator(useLocale())
  const telling =
    offertes.length === 1 ? t('vandaag.offerteEen') : t('vandaag.offerteMeer', { n: offertes.length });

  /** Hoeveel tijd er nog is, in woorden die bij een offerte horen. */
  function termijn(o: VandaagOfferte): string {
    // [OFFERTE-AKKOORD] Ja is geen termijn maar een uitkomst: hier staat wat er te DOEN is.
    if (o.followupState === 'geaccepteerd') return t('vandaag.offerteAkkoord');
    if (o.followupState === 'verlopen') {
      const dagen = Math.abs(o.followupDays);
      return dagen === 1 ? t('vandaag.offerteVerlopenEen') : t('vandaag.offerteVerlopenMeer', { n: dagen });
    }
    if (o.followupDays === 0) return t('vandaag.offerteVandaag');
    if (o.followupDays === 1) return t('vandaag.offerteMorgen');
    return t('vandaag.offerteOver', { n: o.followupDays });
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <header style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, color: M3.onSurface, margin: 0 }}>
          {t('vandaag.offertes')}
        </h2>
        <p style={{ fontSize: 13.5, color: M3.onSurfaceVariant, margin: '2px 0 0' }}>
          {t('vandaag.offertesUitleg')} · {telling}
        </p>
      </header>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {offertes.map((o) => {
          const verlopen = o.followupState === 'verlopen';
          const gewonnen = o.followupState === 'geaccepteerd';
          return (
            <div
              key={o.id}
              style={{
                background: M3.surface, borderRadius: 14, padding: '12px 14px',
                border: `1px solid ${gewonnen ? '#C8E6C9' : verlopen ? '#F9DEDC' : M3.outlineVariant}`,
                display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 500, color: M3.onSurface, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {o.client_name?.trim() || t('vandaag.onbekendePartij')}
                </p>
                <p style={{ fontSize: 12.5, color: gewonnen ? '#137333' : verlopen ? '#B3261E' : M3.onSurfaceVariant, margin: '2px 0 0', fontWeight: gewonnen ? 600 : 400 }}>
                  {termijn(o)}
                  {o.invoice_number ? ` · ${o.invoice_number}` : ''}
                </p>
              </div>
              {/* Het bedrag is het OPGESLAGEN totaal, net als op de rest van deze pagina: een
                  eerlijke lezing, nooit een som die hier wordt gemaakt. */}
              <span style={{ fontSize: 14, color: M3.onSurfaceVariant, fontFamily: 'Roboto Mono, monospace', whiteSpace: 'nowrap' }}>
                {formatEuroNL(Math.abs(o.total_inc_btw ?? 0))}
              </span>
              <button
                onClick={() => onOpen(o.id, o.direction)}
                style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: M3.primary, color: 'white', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {t('vandaag.bekijken')}
              </button>
              <button
                onClick={() => onDismiss(o.id)}
                aria-label={t('vandaag.verbergenVandaag')}
                style={{ background: 'none', border: 'none', color: M3.onSurfaceVariant, fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// [CREDIT-TERUG] The creditnotas that still owe the customer money. The AMOUNT is what the pure
// rule decided has to go back — not the creditnota's total, which a credit against an unpaid
// invoice never returns. A standalone creditnota (an invoice outside BoekBrug) is flagged: there
// was no invoice to compare with, so the owner judges whether the customer had paid.
function RefundSection({
  refunds,
  unknown,
  onOpen,
  onDismiss,
}: {
  refunds: RefundableCredit[];
  unknown: boolean;
  onOpen: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const t = translator(useLocale())
  const telling =
    refunds.length === 1 ? t('vandaag.terugbetalenEen') : t('vandaag.terugbetalenMeer', { n: refunds.length });
  return (
    <section style={{ marginBottom: 32 }}>
      <header style={{ marginBottom: 12 }}>
        <h2 style={{ fontSize: 17, fontWeight: 600, color: M3.onSurface, margin: 0 }}>
          {t('vandaag.terugbetalen')}
        </h2>
        <p style={{ fontSize: 13.5, color: M3.onSurfaceVariant, margin: '2px 0 0' }}>
          {t('vandaag.terugbetalenUitleg')}{unknown ? '' : ` · ${telling}`}
        </p>
      </header>
      {unknown ? (
        <p style={{ fontSize: 13.5, color: M3.error, margin: 0 }}>{t('vandaag.terugbetalenMislukt')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {refunds.map((r) => (
            <div
              key={r.id}
              style={{
                background: M3.surface, borderRadius: 14, padding: '12px 14px',
                border: `1px solid ${M3.outlineVariant}`,
                display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 500, color: M3.onSurface, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.clientName?.trim() || t('vandaag.onbekendePartij')}
                </p>
                <p style={{ fontSize: 12.5, color: M3.onSurfaceVariant, margin: '2px 0 0' }}>
                  {r.invoiceNumber ?? ''}{r.invoiceNumber && r.invoiceDate ? ' · ' : ''}{r.invoiceDate ? formatDateNL(r.invoiceDate) : ''}
                  {r.standalone ? ` · ${t('vandaag.terugbetalenLos')}` : ''}
                </p>
              </div>
              <span style={{ fontSize: 14, color: M3.onSurfaceVariant, fontFamily: 'Roboto Mono, monospace', whiteSpace: 'nowrap' }}>
                {formatEuroNL(r.amount)}
              </span>
              <button
                onClick={() => onOpen(r.id)}
                style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: M3.primary, color: 'white', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {t('vandaag.bekijken')}
              </button>
              <button
                onClick={() => onDismiss(r.id)}
                aria-label={t('vandaag.verbergenVandaag')}
                style={{ background: 'none', border: 'none', color: M3.onSurfaceVariant, fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ListSection({
  title,
  subtitle,
  invoices,
  onOpen,
  onConfirmPaid,
  onDismiss,
  // [VANDAAG-DOEN] Doorgegeven, niet hier bedacht: de sectie weet niets van betalen, hij geeft
  // alleen door wat de kaart nodig heeft om de handeling ter plekke af te maken.
  payingId = null,
  payBusyId = null,
  paidIds,
  payError,
  onPayNow,
  onOpenFullPay,
}: {
  title: string;
  subtitle: string;
  invoices: VandaagInvoice[];
  onOpen: (id: string, direction: string) => void;
  // null when the list is outgoing (no "Al betaald?" — that is the client's job).
  onConfirmPaid: ((id: string) => void) | null;
  onDismiss: (id: string) => void;
  payingId?: string | null;
  payBusyId?: string | null;
  paidIds?: Set<string>;
  payError?: Record<string, string>;
  onPayNow?: (id: string, paymentMethod: "bank" | "kas") => void;
  onOpenFullPay?: (id: string) => void;
}) {
  // [TAAL] Bound before the early return — a hook may not sit behind a condition.
  const t = translator(useLocale())
  if (invoices.length === 0) return null;

  // One flat list in the chosen sort order — no "Al langer open" split (it made
  // a 36-days-late invoice render BELOW a 10-days-late one: looked like a bug).

  const countLabel =
    invoices.length === 1 ? t('vandaag.eenFactuur') : t('vandaag.meerFacturen', { n: invoices.length });

  return (
    <section style={{ marginBottom: 32 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 12,
          gap: 8,
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: M3.onSurface,
              margin: "0 0 2px",
            }}
          >
            {title}
          </h2>
          <p style={{ fontSize: 13, color: M3.onSurfaceVariant, margin: 0 }}>
            {subtitle}
          </p>
        </div>
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: M3.onSurfaceVariant,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {countLabel}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {invoices.map((inv) => (
          <InvoiceCard
            key={inv.id}
            invoice={inv}
            onOpen={onOpen}
            onConfirmPaid={onConfirmPaid}
            onDismiss={onDismiss}
            payOpen={payingId === inv.id}
            payBusy={payBusyId === inv.id}
            justPaid={paidIds?.has(inv.id) ?? false}
            payErrorText={payError?.[inv.id] ?? ""}
            onPayNow={onPayNow}
            onOpenFullPay={onOpenFullPay}
          />
        ))}
      </div>
    </section>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
// [TODAY-UX-FIELDS] Card shows party name, invoice number, dates, and the STORED
// total (read directly from total_inc_btw — never computed here), plus the human
// due status and the clear action buttons.

function InvoiceCard({
  invoice,
  onOpen,
  onConfirmPaid,
  onDismiss,
  // [VANDAAG-DOEN] Alles hieronder is nieuw: de handeling gebeurt op deze kaart in plaats van
  // op een ander scherm. Optioneel getypt zodat de kaart ook zonder blijft werken.
  payOpen = false,
  payBusy = false,
  justPaid = false,
  payErrorText = "",
  onPayNow,
  onOpenFullPay,
}: {
  invoice: VandaagInvoice;
  onOpen: (id: string, direction: string) => void;
  onConfirmPaid: ((id: string) => void) | null;
  onDismiss: (id: string) => void;
  payOpen?: boolean;
  payBusy?: boolean;
  justPaid?: boolean;
  payErrorText?: string;
  onPayNow?: (id: string, paymentMethod: "bank" | "kas") => void;
  onOpenFullPay?: (id: string) => void;
}) {
  const t = translator(useLocale())
  const due = invoice.due_date as string;
  const accent = accentOf(due);
  const isIncoming = invoice.direction === "incoming";

  // [HONEST-HOME] A negative incoming total is a creditnota: it REDUCES what you
  // owe, it is not something you "pay". So it must not offer "Betalen" / "Al
  // betaald?" — only "Bekijken". (This is the same rule the home snapshot uses.)
  const isCredit = isIncoming && (invoice.total_inc_btw ?? 0) < 0;

  // [PARTIAL-PAY] Wat er van deze factuur nog openstaat — ÉÉN keer gerekend, voor het bedrag
  // bovenaan de kaart én voor de bevestigingsknoppen eronder. Die stonden apart, en dat was
  // precies waar het misging: de kaart toonde het restant en het paneel eronder zei "het hele
  // bedrag". Zie de opmerking bij dat paneel.
  const totalIncBtw = typeof invoice.total_inc_btw === "number" ? invoice.total_inc_btw : null;
  const paidSoFar = Math.max(0, invoice.amount_paid ?? 0);
  const isPartial =
    totalIncBtw !== null && paidSoFar > 0.005 && paidSoFar < Math.abs(totalIncBtw) - 0.005;
  const openstaand =
    totalIncBtw === null
      ? null
      : isPartial
        ? (totalIncBtw < 0 ? -1 : 1) * (Math.abs(totalIncBtw) - paidSoFar)
        : totalIncBtw;

  // One clear verb per direction (clarity #3). Outgoing says "Bekijken" — the
  // button routes to the invoice page. Automatic payment reminders now run on
  // their own (opt-in in Instellingen → the /api/cron/reminders schedule); this
  // list stays a calm overview and deliberately does NOT expose an ad-hoc one-tap
  // send (the schedule is tier-based; per-invoice pause/history lives on the
  // invoice page).
  const primaryLabel = isCredit ? t('vandaag.bekijken') : isIncoming ? t('inkoop.betalen') : t('vandaag.bekijken');

  return (
    <div
      style={{
        background: "#ffffff",
        border: `1px solid ${M3.hairline}`,
        borderRadius: 16,
        borderInlineStart: `4px solid ${accent}`,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 16,
              fontWeight: 600,
              color: M3.onSurface,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {invoice.client_name?.trim() || t('vandaag.onbekendePartij')}
          </div>

          {/* [TODAY-UX-FIELDS] Invoice number — quiet secondary line. */}
          {invoice.invoice_number?.trim() && (
            <div
              style={{
                fontSize: 13,
                color: M3.onSurfaceVariant,
                marginTop: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              Factuur {invoice.invoice_number.trim()}
            </div>
          )}

          <div
            style={{ fontSize: 14, color: accent, fontWeight: 500, marginTop: 4 }}
          >
            {dueLabel(due, t)}
          </div>

          {/* [TODAY-UX-FIELDS] Dates — factuurdatum + vervaldatum, via the shared
              display formatter (DD-MM-YYYY, timezone-proof). */}
          <div
            style={{ fontSize: 12, color: M3.onSurfaceVariant, marginTop: 2 }}
          >
            Factuurdatum {formatDateNL(invoice.invoice_date)} · Vervalt{" "}
            {formatDateNL(invoice.due_date)}
          </div>

          {/* [TODAY-UX-FIELDS] STORED total — read directly from total_inc_btw, never computed here.
              [PARTIAL-PAY] When a deelbetaling already settled part of it, show the REMAINING
              openstaand (the reconciled truth the bank matcher booked), with the full total as a
              sub-note — never the full total as "te betalen" when only part is left. */}
          {openstaand !== null && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: M3.onSurface }}>
                {formatEuroNL(openstaand)}
              </div>
              {isPartial && totalIncBtw !== null && (
                <div style={{ fontSize: 12, color: "#b06000", marginTop: 2 }}>
                  deels betaald · van {formatEuroNL(totalIncBtw)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* "Negeren" — session-only visual hide. No DB, no status change. */}
        <button
          type="button"
          onClick={() => onDismiss(invoice.id)}
          aria-label={t('vandaag.verbergenVandaag')}
          title={t('vandaag.verbergenVandaag')}
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
            height: 32,
            padding: "0 10px",
            borderRadius: 16,
            border: "none",
            background: M3.hover,
            color: M3.onSurfaceVariant,
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {t('vandaag.verbergen')}
        </button>
      </div>

      {/* Actions row. Primary verb (direction-aware) + an optional "Al betaald?"
          context action for incoming invoices (routes to manage to confirm). */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => onOpen(invoice.id, invoice.direction)}
          style={{
            flex: 1,
            padding: "10px 16px",
            borderRadius: 20,
            border: "none",
            background: M3.primary,
            color: "#ffffff",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {primaryLabel}
        </button>

        {isIncoming && !isCredit && onConfirmPaid && !justPaid && (
          <button
            type="button"
            onClick={() => onConfirmPaid(invoice.id)}
            aria-expanded={payOpen}
            style={{
              flexShrink: 0,
              padding: "10px 16px",
              borderRadius: 20,
              border: `1px solid ${M3.primary}`,
              background: payOpen ? M3.primary : "#ffffff",
              color: payOpen ? "#ffffff" : M3.primary,
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t('vandaag.alBetaald')}
          </button>
        )}
      </div>

      {/* [VANDAAG-DOEN] De handeling zelf, hier. Waarmee is de enige vraag die overblijft:
          het bedrag is bekend en de datum is vandaag. Twee knoppen, geen formulier.

          De ontsnappingsroute staat er altijd bij en is geen sierlijk detail: een deelbetaling
          of een andere datum hoort op het scherm dat ze volledig kan tonen. Deze twee knoppen
          doen bewust alleen het geval dat tientallen keren per kwartaal voorkomt. */}
      {payOpen && !justPaid && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #E8EAED" }}>
          {/* [PARTIAL-PAY] Deze zin zei "vandaag, het hele bedrag", zonder bedrag.
              Op een factuur waarop al een deelbetaling stond was dat gewoon niet waar: de kaart
              erboven toonde € 4.662,80 open van € 6.662,80, en het paneel eronder bood aan "het
              hele bedrag" af te boeken. De boeking zelf klopte wél — apply_manual_payment leest een
              leeg bedrag als "de rest" — maar de eigenaar werd verteld dat hij € 6.662,80 afboekte
              terwijl er € 4.662,80 werd geboekt. Hij aarzelt bij een handeling die goed is, of hij
              drukt en gelooft daarna dat er € 2.000 meer van zijn rekening is gegaan dan er ging.
              Wat er van de kaart afgeleid werd, stond in twee losse berekeningen; nu in één.

              En het bedrag staat er nu bíj. Dit is een bevestiging over geld, en die noemde geen
              enkel getal. */}
          <div style={{ fontSize: 13.5, color: "#3c4043", marginBottom: 8 }}>
            {openstaand !== null ? (
              isPartial ? (
                <>
                  {t('vandaag.betaaldRestant')}{" "}
                  <strong>{formatEuroNL(openstaand)}</strong>:
                </>
              ) : (
                <>
                  {t('vandaag.betaaldHeel')}{" "}
                  <strong>{formatEuroNL(openstaand)}</strong>:
                </>
              )
            ) : (
              // Geen bedrag op de factuur: dan noemen we er ook geen. Liever een kale zin dan een
              // verzonnen getal onder een knop die geld afboekt.
              <>{t('vandaag.betaaldOpen')}</>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(["bank", "kas"] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={payBusy}
                onClick={() => onPayNow?.(invoice.id, m)}
                style={{
                  padding: "9px 18px",
                  borderRadius: 20,
                  border: `1px solid ${M3.primary}`,
                  background: "#ffffff",
                  color: M3.primary,
                  fontSize: 14.5,
                  fontWeight: 600,
                  cursor: payBusy ? "default" : "pointer",
                  opacity: payBusy ? 0.5 : 1,
                }}
              >
                {payBusy ? t('act.bezig') : m === "bank" ? t('lijst.bank') : t('lijst.contant')}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onOpenFullPay?.(invoice.id)}
              style={{
                padding: "9px 6px",
                border: "none",
                background: "none",
                color: "#5f6368",
                fontSize: 13.5,
                textDecoration: "underline",
                cursor: "pointer",
              }}
            >
              {t('vandaag.deelbetaling')}
            </button>
          </div>
          {payErrorText && (
            <p role="alert" style={{ margin: "8px 0 0", fontSize: 13, color: "#B3261E", lineHeight: 1.5 }}>
              {payErrorText}
            </p>
          )}
        </div>
      )}

      {/* Geboekt. De regel blijft staan tot de lijst opnieuw laadt — hem meteen laten verdwijnen
          leest als "weg", en de eigenaar hoort te ZIEN dat zijn handeling is aangekomen. */}
      {justPaid && (
        <div style={{ marginTop: 10, fontSize: 13.5, color: "#188038", fontWeight: 600 }}>
          {t('vandaag.afgeboekt')}
        </div>
      )}
    </div>
  );
}

// ─── Load-error state ─────────────────────────────────────────────────────────
// [COHERENCE-ERRSTATE] Shown when a server query failed. It is deliberately NOT
// the calm "✓ niets" checkmark: on an error we do not KNOW there is nothing to do,
// so we must not claim it. Honest wording + a retry, never false reassurance.
function LoadError({ onRetry }: { onRetry: () => void }) {
  const t = translator(useLocale())
  return (
    <div
      style={{
        background: "#FCECEA",
        border: `1px solid ${M3.error}`,
        borderRadius: 16,
        padding: "32px 24px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
      <div
        style={{
          fontSize: 17,
          fontWeight: 600,
          color: M3.onSurface,
          marginBottom: 4,
        }}
      >
        {t('vandaag.fout.taken')}
      </div>
      <div style={{ fontSize: 14, color: M3.onSurfaceVariant, marginBottom: 16 }}>
        {t('vandaag.fout.ophalen')}
      </div>
      <button
        onClick={onRetry}
        style={{
          padding: "10px 20px",
          borderRadius: 12,
          border: "none",
          background: M3.primary,
          color: "#fff",
          fontSize: 15,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {t('inkoop.opnieuwProberen')}
      </button>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyAllClear() {
  const t = translator(useLocale())
  return (
    <div
      style={{
        background: "#ffffff",
        border: `1px solid ${M3.hairline}`,
        borderRadius: 16,
        padding: "40px 24px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
      <div
        style={{
          fontSize: 17,
          fontWeight: 600,
          color: M3.onSurface,
          marginBottom: 4,
        }}
      >
        {t('vandaag.nietsNodig')}
      </div>
      <div style={{ fontSize: 14, color: M3.onSurfaceVariant }}>
        {t('vandaag.geenVervallen')}
      </div>
    </div>
  );
}