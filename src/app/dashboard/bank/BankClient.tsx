'use client'

// src/app/dashboard/bank/BankClient.tsx
// [BOEK-016] Bank reconciliation UI — Material You (BoekBrug Design System v1.0), mobile-first.
// Flow: upload bankafschrift → /api/bank/upload → /api/bank/match → review suggestions → confirm.
// Philosophy: AI suggests, the human confirms. 'auto' = pre-filled (still one tap to confirm).

import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
// [SERVER-ZIN] Never a machine code in front of the owner — see server-message.ts.
import { failureText } from '@/lib/server-message'
// [MELDING-WEG] The X on the upload's report card.
import { DismissX } from '@/components/ui/DismissX'
// [UPLOAD-PLAFOND] Fit a document to the upload budget and survive a platform 413 — upload-fit.ts.
import { sendWithFit } from '@/lib/upload-fit'
import Link from 'next/link'
import { reconcileBatch, resolveBatchNumbers, settleableAmount } from '@/lib/bank-batch-reconcile'
// [PAYMENT-NAMES-MISSING] What the payment NAMED, including invoices not yet imported.
import { namedInvoiceNumbers, missingNamedInvoices, missingInvoiceNoticeText } from '@/lib/payment-named-invoices'
// [SLOT-WAAR] Eén rij per factuurnummer — de drie bronnen tegen elkaar gehouden, op één plek.
import { slotNumbers as slotNumbersOf } from '@/lib/bank-slot-numbers'
import { parsePaymentPeriod } from '@/lib/payment-period'
import { quartersPresent, quarterLabelOf, matchesQuarter, lastCompletedQuarter } from '@/lib/quarter'
import { isPartialPaymentHint, parseReferenceNumbers, isReferenceNumberToken } from '@/lib/bank-matching'
// [WAAROM-WACHT-BANK] Eén zin per regel die zichzelf niet koppelde. De component draagt zelf
// geen taal — dezelfde woordenlijst als de verificatiewachtrij, zie why-waiting.ts.
import { explainWaiting } from '@/lib/why-waiting'
import { isPosPayoutDescription } from '@/lib/bank-identity'
import { categoryLabel } from '@/lib/bank-categories'
import { BANK_IGNORE_REASONS, BANK_IGNORE_REASON_LABELS, bankIgnoreReasonLabel, ignoreReasonGroups } from '@/lib/bank-ignore-reason'
import { rowMatchesQuery } from '@/lib/search'
import { useDialog } from '@/components/ui/Dialog'
// [GROTE-STAP] One extra beat, proportional to what a slip would cost — see grote-stap.ts. Undoing
// a booking is the one destructive action on this screen that took a single tap at any amount.
import { beoordeelStap, groteStapZin } from '@/lib/grote-stap'
import { useToast } from '@/components/ui/Toast'
// [OPEN-TOTAL] Eén definitie van openstaand, gedeeld met elk ander scherm.
import { openAmount } from "@/lib/partial-payment"
// [ENABLEBANKING] De bankkoppeling staat BOVEN de uploadkaart, niet in de plaats ervan: een
// koppeling kan verlopen of geweigerd worden, en dan moet uploaden er gewoon nog staan.
import BankConnectPanel from './BankConnectPanel'
import WachtkoppelingPanel from '@/components/bank/WachtkoppelingPanel'
// [DESIGN] Palette and radius come from the shared source now
// (src/lib/design/tokens.ts). This file used to declare its own copy; see the
// header of tokens.ts for why the copies had to go — two of the values in them
// were below the contrast floor for text.
import { M3, R, COLUMN, sheetPaddingBottom } from '@/lib/design/tokens'
// [BANK-SPLIT] One parser for a typed amount, shared with every other money field in the app,
// so "1.465,41" means the same thing here as on the pay screen.
import { parseAmountInput } from '@/lib/partial-payment'
// [FULL-CORRECTION] The correction editor, shared with the pay screen.
import InvoiceCorrectionModal, { type BtwSplitRow, type CorrectableInvoice } from '@/components/invoice/InvoiceCorrectionModal'
// [STATIEGELD-GAT] Het statiegeld dat de lezer liet vallen — zie statiegeld.ts.
import { type DepositGap } from '@/lib/statiegeld'
// [BACK-CLOSES] Back closes what is open — see src/lib/use-close-on-back.ts.
import { useCloseOnBack } from '@/lib/use-close-on-back'
import { round2 } from '@/lib/invoice-totals'
import BijlageStrip from '@/components/bank/BijlageStrip'
import LijnFactuurSheet, { type LijnFactuurPrefill } from '@/components/bank/LijnFactuurSheet'
import type { BankAttachment } from '@/lib/bank-attachments'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

// ─── Design tokens — mirrors BoekBrug Design System v1.0 (FacturenClient) ────
const FONT = "'Roboto', -apple-system, sans-serif"
const FONT_NUM = "'Roboto Mono', 'SF Mono', monospace"
const EL1 = '0 1px 2px rgba(0,0,0,0.08)'

const eur = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' })

// [BANK-FORMAT-GUARD] File extensions we can actually parse into transactions.
// MT940 (.940/.sta/.mt940/.txt) and CAMT.053 (.xml). A CSV or PDF is NOT readable
// into bank_transactions — it can still be kept for the accountant, but the owner
// must be told the transactions weren't imported (clear modal, not a quick toast).
// [BANK-CSV-LEESBAAR] .csv hoort hier, want de server LEEST hem al.
// bank-csv.ts (ING, Rabobank, bunq, SNS, ASN, Triodos, Knab, …) landde nadat deze lijst was
// geschreven, en de lijst bleef staan. Gevolg: een CSV die keurig 43 transacties opleverde
// kreeg alsnog de "kon niet worden uitgelezen"-melding, omdat de gate `!leesbaar || parsed===0`
// is en de eerste helft altijd waar was. De tweede helft dekt de echte mislukking al — een
// bestand dat NUL transacties gaf — dus de extensielijst mag alleen formaten uitsluiten die
// de parser principieel niet kent (PDF, foto van een afschrift).
const READABLE_BANK_EXTS = ['.xml', '.940', '.sta', '.mt940', '.txt', '.csv']
function isReadableBankFile(name: string): boolean {
  const lower = name.toLowerCase()
  return READABLE_BANK_EXTS.some((ext) => lower.endsWith(ext))
}

// [BANK-IBAN] Would the SERVER book this match without a tap? One predicate, because this page
// asked the question in two places and the two answers had already drifted: the on-load gate was
// corrected to accept an IBAN match and the counter that drives the "N zekere betalingen" card
// was not, so a statement matched purely on supplier IBAN + exact sum was booked silently while
// the screen still said there was nothing to handle.
//
// Mirrors bank-matching.autoConfirmTier: outcome 'auto' with a best candidate, the amount matches
// to the cent, ONE referenced invoice number, not an instalment — and then either 'certain'
// (invoice number printed OR the supplier IBAN matches) or 'amount_only' (counterpart name, no
// reference/IBAN). The server stays authoritative on what it actually books; this only decides
// whether it is worth asking, and what to tell the owner is waiting.
function isServerAutoBookable(s: Suggestion): boolean {
  if (s.outcome !== 'auto' || !s.best) return false
  // [AL-GEBOEKT-KLEMT] The payment names an invoice that is already booked. That is the one
  // sentence a bulk action may never talk over: "zekere betaling" means the bank agrees, and here
  // the bank is pointing at a bill that is settled — so every candidate this would book is a
  // DIFFERENT, still-open invoice. Measured: one of the three lines that named an already-paid
  // invoice reached this screen with a suggestion the server called 'auto'.
  if (s.quotedSettled) return false
  // [SOM-KLOPT] Same rule over the whole named set. A payment whose named invoices add up to it is
  // accounted for; anything this would book is a different, still-open bill.
  if (s.quotedSet?.fullySettled) return false
  const sig = s.best.signals
  if (!sig.includes('amount')) return false // the amount is the money-truth — required by both tiers
  const certain = sig.includes('reference') || sig.includes('iban')
  const amountOnly = sig.includes('counterpart')
  if (!certain && !amountOnly) return false
  // [BANK-REF-ONE-SOURCE] The server's own count — a raw comma split counted free-text fragments
  // and any part under four characters as invoice numbers, so this gate fired on rows the server
  // considers single-invoice. A multi-invoice batch is the engine's separate path.
  if (parseReferenceNumbers(s.reference).length > 1) return false
  if (isPartialPaymentHint(`${s.reference ?? ''} ${s.description ?? ''}`)) return false
  return true
}

// [BANK-STATEMENTS] Format an upload timestamp for the statements table.
function fmtUploadDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
}

// [BANK-DETAILS] Tidy the raw bank description for display: drop the "USTD//"
// remittance marker and the field-separator slashes ING leaves in, so the full
// text reads cleanly ("Lidl 213 Tilburg TILBURG NLD Pasvolgnr: 900 ...").
function cleanBankDescription(raw: string | null): string {
  if (!raw) return ''
  return raw
    .replace(/\/*USTD\/*/gi, ' ')
    .replace(/\s*\/\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Types (mirror the /api/bank/match DTO) ──────────────────────────────────
type Outcome = 'auto' | 'choice' | 'none'
interface Candidate {
  invoiceId: string
  invoiceNumber: string | null
  amount: number | null // [BANK-BATCH-RECONCILE] invoice gross total, to sum-check a batch
  invoiceDate: string | null // [BANK-CHOICE-CLARITY] tells same-amount candidates apart
  confidence: number
  signals: string[]
  reason: string
  // [PARTIAL-PAY] Already settled by earlier instalments, and what is therefore still open.
  // The confirm warning compares the payment against `remaining`, not the full total.
  // Absent on candidates the batch-reconcile path builds → callers fall back to `amount`.
  amountPaid?: number
  remaining?: number
  // [CIRKEL] Whose invoice this is. The matcher always sent it (bank-matching.ts clientName);
  // this interface dropped it at the type boundary, so "kies de juiste factuur" was a choice
  // between bare numbers and dates.
  clientName?: string | null
}
interface Suggestion {
  transactionId: string
  date: string
  amount: number
  description: string
  counterpart: string | null
  // [SEARCH] tegenrekening IBAN — so the zoekbalk can match a line by IBAN as well.
  iban?: string | null
  // [BANK-COUNTERPART-HISTORY] What the owner decided about this counterpart before. Server-
  // computed over lines that already carry a category; null when there is nothing honest to say.
  history?: { count: number; topCategory: string; topCount: number; matchedBy: 'iban' | 'naam' } | null
  // [BANK-IGNORE-REDEN] Waarom deze regel op Genegeerd staat. null voor een rij van vóór de kolom.
  ignoreReason?: string | null
  reference: string | null
  outcome: Outcome
  best: Candidate | null
  candidates: Candidate[]
  // [BANK-MULTI-LINK-PERSIST] Reload-safe link state from the match route.
  // partiallyLinked: this pending tx already has an invoice paid against it.
  // allCovered: every reference number is now paid (→ it's effectively done).
  partiallyLinked?: boolean
  allCovered?: boolean
  // [BANK-SLOT-PERSIST] Server-computed reference numbers already paid against this tx,
  // so a paid slot shows "Betaald" after a reload (session confirm state is gone).
  coveredNumbers?: string[]
  // [BANK-ONE-PAYMENT-MANY-INVOICES] Euros of this bank line already booked on invoices.
  // null = nothing linked yet, or links older than amount_applied (then we say nothing).
  appliedAmount?: number | null
  // [BANK-PAID-EXPLAINED] This debit matches an already-PAID invoice → not a missing inkoopfactuur.
  explainedByPaid?: boolean
  // [CIRKEL] This debit matches an invoice STILL IN THE VERIFY QUEUE — the document exists, one
  // tap from verified. The card links straight to it instead of asking for a re-upload.
  explainedByQueued?: { invoiceId: string; invoiceNumber: string | null } | null
  // [BANK-AMOUNT-ONLY] 'amount_only' when this line was auto-booked on amount+counterpart only
  // (no printed number/IBAN) → the Gekoppeld card shows a "controleer" flag. null otherwise.
  matchReason?: string | null
  // [BANK-SUM-SUGGEST] Server-computed: this payment is EXACTLY the sum of these 2..4 open
  // invoices of THIS counterparty (unique tie, cents-exact) — a suggestion for the "Geen
  // factuur" card. Booking still runs invoice-by-invoice through the normal confirm.
  // [CREDIT-VERREKEN] `amounts` is signed per member, so the card can print the subtraction it
  // is claiming. Optional: an older cached response has none, and then it reads as it always did.
  sumMatch?: { invoiceIds: string[]; invoiceNumbers: (string | null)[]; total: number; amounts?: number[] } | null
  // [WAAROM-WACHT-BANK] Machinecode van de server: waarom deze regel niets vond. Null wanneer er
  // niets eerlijks te zeggen valt, en dan zegt de kaart niets — zie bank-waiting-reason.ts.
  waitReason?: string | null
  /** [BIJLAGE-BIJ-REGEL] Files kept with this line. */
  attachments?: BankAttachment[]
  /** [OPEN-FACTUUR] On a linked line: the invoices it paid, so the card can open them. */
  linkedInvoices?: { invoiceId: string; invoiceNumber: string | null }[]
  /** [STORNO] A reversed incasso: the matched debit this credit undoes. */
  storno?: { originTxId: string; originDate: string | null; invoiceId: string; invoiceNumber: string | null } | null
  // [AL-GEBOEKT] De factuur die deze betaling NOEMT, wanneer die al is afgeboekt. Geen kandidaat en
  // niet te bevestigen: dit is het antwoord op "waarom klopt er hier niets", en het vervangt de
  // kiezer in plaats van eronder te staan — zie bank-quoted-invoice.ts.
  quotedSettled?: QuotedRef | null
  // [SOM-KLOPT] ALLE facturen die deze betaling noemt, en of ze samen precies dit bedrag zijn.
  // quotedSettled hierboven antwoordt over ÉÉN factuur; een betaling van € 466,30 die
  // "2601695, 2601826, 2601291" noemt (162,19 + 148,68 + 155,43) las daardoor als een bijna-match
  // op de eerste, terwijl de som op de cent klopt. Zie bank-quoted-invoice.ts.
  quotedSet?: {
    settled: QuotedRef[]
    /** Genoemd, aanwezig, nog OPEN — dit zijn echte kandidaten en de kiezer hoort te blijven. */
    open: QuotedRef[]
    unknownNumbers: string[]
    total: number | null
    /** [CREDIT-TEKEN] Waarom `total` null is, als hij dat is — zie bank-quoted-invoice.ts. */
    totalUnknownReason?: 'amount' | null
    coversPayment: boolean
    /** Alles wat genoemd is, is geboekt — pas dán valt er werkelijk niets te kiezen. */
    fullySettled: boolean
  } | null
}
/** Eén factuur die een betaling NOEMT, zoals /api/bank/match hem teruggeeft. */
interface QuotedRef {
  invoiceId: string; invoiceNumber: string; amount: number | null
  clientName: string | null; amountAgrees: boolean; lockedByAccountant: boolean
  /** [CREDIT-TEKEN] Dit document TREKT AF van de betaling — zie bank-quoted-invoice.ts. */
  isCredit?: boolean
  /** [CREDIT-TEKEN] false = tweede rij met een al geteld nummer; telt niet mee in `total`. */
  countedInTotal?: boolean
}
interface MatchResponse {
  ok: boolean
  summary: { pending: number; auto: number; choice: number; none: number }
  suggestions: Suggestion[]
  /**
   * [BLIND-GEMATCHT] What this answer could not use. Absent on the ordinary day; present means the
   * suggestions below are worse than yesterday's for a reason the owner cannot otherwise see.
   */
  degraded?: { memory?: boolean; refusals?: boolean; supplierIbans?: boolean }
}

// [MOVE-PAYMENT] Shapes returned by GET /api/invoice/payment/move.
interface MoveTarget {
  id: string
  invoice_number?: string | null
  client_name?: string | null
  invoice_date?: string | null
  total_inc_btw?: number | null
  amount_paid?: number | null
}
interface MoveSource { id: string; invoice_number?: string | null; client_name?: string | null }
interface MovePayment {
  id: string
  amount_applied: number
  transaction_id?: string | null
  paid_on?: string | null
  method?: string | null
  /** false for a pre-[PARTIAL-PAY] link: no recorded amount, so there is nothing to move. */
  movable: boolean
  targets: MoveTarget[]
}

export default function BankClient() {
  const t = translator(useLocale())
  const dialog = useDialog()
  // [MOTION] The app-wide snackbar (components/ui/Toast), bound to the name the
  // call sites already used. The local one it replaces could not stack, was
  // never announced to a screen reader, and vanished with the page.
  const showToast = useToast()
  // [MOVE-PAYMENT] Which payment sits on this bank line, and which invoices it may move to. The
  // server ranks and filters the targets (same rules as the RPC), so this holds display only.
  const [moveCtx, setMoveCtx] = useState<{ txId: string; source: MoveSource; payments: MovePayment[] } | null>(null)
  useCloseOnBack(!!moveCtx, () => setMoveCtx(null))
  const [busy, setBusy] = useState(false)
  // [BANK-DND] true while a file is being dragged over the upload zone.
  const [dragActive, setDragActive] = useState(false)
  const [uploadInfo, setUploadInfo] = useState<{ format: string; parsed: number; inserted: number; skipped: number; unreadable: number; autoBooked?: number; balanceWarning?: string | null; continuityWarning?: string | null; balanceReconciliation?: { ok: boolean; checkable: boolean; opening: number | null; closing: number | null; txCount: number } | null } | null>(null)
  // [BANK-STATEMENTS] Uploaded statements (filename + upload time) and the
  // "refresh names" action that upgrades older rows' names from their description.
  const [statements, setStatements] = useState<{ id: string; name: string; uploadedAt: string; size: number }[] | null>(null)
  const [refreshingNames, setRefreshingNames] = useState(false)
  // [BANK-REMATCH] The forced "try everything again" pass, and its last result — kept on screen
  // instead of only in a toast, because the interesting answer ("gevonden, maar niet aangeraakt")
  // is exactly the one the owner needs to still be readable after the toast has gone.
  const [rematching, setRematching] = useState(false)
  const [rematchInfo, setRematchInfo] = useState<{ restored: number; booked: number; ambiguous: number; examined: number; supplierIbansUnavailable?: boolean } | null>(null)
  // [BANK-STATEMENT-DELETE] The statement pending deletion (shown in a confirm
  // dialog) and the id currently being deleted (to disable its row button).
  const [statementToDelete, setStatementToDelete] = useState<{ id: string; name: string } | null>(null)
  useCloseOnBack(!!statementToDelete, () => setStatementToDelete(null))
  const [deletingStatementId, setDeletingStatementId] = useState<string | null>(null)
  // [BANK-FORMAT-GUARD] When the owner picks a file we can't read into transactions
  // (CSV, PDF, or any non-MT940/CAMT file), we show a clear modal — not a quick
  // toast — explaining what happened and which formats to use. `kept` distinguishes
  // the two cases: rejected before upload (kept=false) vs stored for the accountant
  // but unreadable as transactions (kept=true).
  const [formatNotice, setFormatNotice] = useState<{ name: string; kept: boolean } | null>(null)
  useCloseOnBack(!!formatNotice, () => setFormatNotice(null))
  const [data, setData] = useState<MatchResponse | null>(null)
  const [selected, setSelected] = useState<Record<string, string>>({}) // txId → invoiceId
  // [BANK-MULTI-CONFIRM] One transaction can cover several invoices, so we track
  // ALL invoice numbers confirmed this session per transaction, plus whether the
  // backend reported every reference number as covered (allCovered). The tx only
  // counts as "done" (→ Gekoppeld, leaves Te bevestigen) once allCovered is true.
  const [confirmed, setConfirmed] = useState<Record<string, { numbers: string[]; allCovered: boolean }>>({}) // txId → confirmation state
  // [P1-UNCATEGORIZED] Count of bank lines with NO category (not tied to an invoice). Money on
  // these lines is silently absent from the W&V/BTW until categorized — surface it, never hide it.
  const [uncatCount, setUncatCount] = useState(0)
  // [BANK-GELD-NIET-GEBOEKT] Hoevéél geld daarin zit, uit en in apart. `null` = de server kon het
  // niet optellen — nooit 0, want dat zou beweren dat er geen geld buiten de boeken staat over een
  // som die niet gelukt is.
  const [uncatOut, setUncatOut] = useState<number | null>(null)
  const [uncatIn, setUncatIn] = useState<number | null>(null)
  const [processingId, setProcessingId] = useState<string | null>(null)
  // [BANK-BATCH-CONFIRM] Bulk-confirm only for strong 'auto' single-invoice matches
  // (each already carries an unambiguous best candidate from the bank statement).
  // 'choice' needs a human pick, multi-invoice needs per-number action — both stay
  // single-confirm. selectedForBatch holds the txIds the owner ticked.
  const [selectedForBatch, setSelectedForBatch] = useState<Set<string>>(new Set())
  const [batchRunning, setBatchRunning] = useState(false)
  // [BANK-AUTO-CONFIRM] "Quiet by default": the app books the near-certain matches itself.
  const [autoRunning, setAutoRunning] = useState(false)
  const [autoDoneCount, setAutoDoneCount] = useState<number | null>(null)
  // [KAS-ACHTER-BANK] Wat de pas BEWUST niet heeft geboekt. Onder het kasstelsel is de betaaldatum
  // btw-timing: een match op bedrag + naam (geen gedrukt factuurnummer) in een kwartaal dat al is
  // aangegeven laat de app aan de eigenaar, omdat een verkeerde keuze daar buiten de app terechtkomt
  // en alleen met een suppletie te herstellen is. Een goede beslissing — die tot nu toe alleen in
  // een serverlog stond, terwijl de eigenaar naar precies die regels zat te kijken.
  const [kasRefusals, setKasRefusals] = useState<{ filed_quarter?: number; unknown_filing?: number } | null>(null)
  // [BANK-AUTO-RUN] Guard so the app auto-handles the near-certain payments ONCE per page
  // load, the moment they appear — the owner should never have to press a button for a
  // payment the app is already certain of. Set before the async call so a re-render mid-flight
  // (runMatch updates `data`) can't fire a second pass.
  const autoRanRef = useRef(false)
  // [BANK-FILTER] Free-text filter for the "Geen factuur" list. With 170+ rows,
  // typing part of a name ("Lidl", "ASM") is faster than scrolling or a long
  // dropdown of every counterpart. Matches counterpart name, reference, or date.
  // [SEARCH-DEEPLINK] Seeded from ?find= (set by the global Cmd+K search when the owner
  // opens a bank hit) so the exact line surfaces here. Synced on param change — a ?find=
  // push can arrive while already mounted; local typing never changes the param.
  const searchParams = useSearchParams()
  const findParam = searchParams.get('find') ?? ''
  const [filterText, setFilterText] = useState(findParam)
  useEffect(() => {
    const t = setTimeout(() => setFilterText(findParam), 0)
    return () => clearTimeout(t)
  }, [findParam])
  const [verwerktCtx, setVerwerktCtx] = useState<{ number: string } | null>(null)
  useCloseOnBack(!!verwerktCtx, () => setVerwerktCtx(null))
  // [DECLARED-INVOICE] Open when a booking was refused because the payment names an invoice that is
  // not in the administration yet. Nothing was written, so every way out is still available: add the
  // missing invoice first, put only part of the payment on this one, or book it all anyway.
  const [splitCtx, setSplitCtx] = useState<{
    txId: string; invoiceId: string; invoiceNumber: string | null;
    missingNumbers: string[]; detail: string;
  } | null>(null)
  useCloseOnBack(!!splitCtx, () => setSplitCtx(null))
  const [splitAmount, setSplitAmount] = useState('')
  // [FULL-CORRECTION] The invoice being corrected from this screen, once its full record has been
  // fetched. A bank card carries only what a MATCH needs — number, gross total, date — so the
  // breakdown is fetched when the dialog opens rather than loaded onto every candidate in the list.
  const [correctFor, setCorrectFor] = useState<CorrectableInvoice | null>(null)
  // [SPLIT-CORRECTIE] De specificatie hoort bij dezelfde GET; het bewijsblob zelf blijft server-side.
  const [correctBtwRows, setCorrectBtwRows] = useState<BtwSplitRow[] | null>(null)
  // [STATIEGELD-GAT] Wat de import op het papier terugvond voor een optelling die tekortkomt.
  const [correctDeposit, setCorrectDeposit] = useState<DepositGap | null>(null)
  // [READING-MEMORY] Wat deze eigenaar bij DEZE leverancier steeds verbetert. De betaalpagina gaf
  // dat al mee aan dezelfde editor; dit scherm gaf niets.
  const [correctHint, setCorrectHint] = useState<string | null>(null)
  // [DECLARED-INVOICE] Busy while the missing invoice named in the payment is being read.
  const [addingMissing, setAddingMissing] = useState(false)
  const missingFileRef = useRef<HTMLInputElement | null>(null)
  // [BANK-PERSIST] On mount, load any already-stored pending transactions so a
  // page refresh doesn't show an empty page. The transactions live in the DB
  // (bank_transactions, status 'pending'); /api/bank/match reads them and
  // returns fresh suggestions. Without this, suggestions only ever existed in
  // component state and vanished on reload.
  const [initialLoading, setInitialLoading] = useState(true)
  // [BANK-TABS] Active tab — defaults to the one the owner acts on.
  // [NOTIF-DEADEND] …unless a deep link names one (?tab=done). The auto-confirm bell
  // ("N facturen automatisch gekoppeld — bekijk ze onder Bevestigd") had no link at all,
  // and pointing it at /dashboard/bank alone would still open "Te bevestigen": the owner
  // reads "look under Bevestigd" and lands on a different tab. An unknown value falls
  // back to the default, and the tab bar keeps working normally afterwards.
  const tabParam = searchParams.get('tab')
  const [bankTab, setBankTab] = useState<'confirm' | 'none' | 'pin' | 'ignored' | 'done'>(
    tabParam === 'done' || tabParam === 'none' || tabParam === 'pin' || tabParam === 'ignored'
      ? tabParam
      : 'confirm'
  )
  // [BANK-QUARTER] Which quarter's transactions to show. 'auto' resolves to the newest
  // quarter that has data, so an owner working on Q2 lands on Q2 instead of an all-quarters
  // pile (old Q1 uploads inflated "Geen factuur" to 335). 'all' shows every quarter.
  //
  // [BANK-QUARTER-LINK] ?year&quarter pins it, because 'auto' resolves to the LAST COMPLETED
  // quarter and a link that arrives from elsewhere usually means a different one. Readiness
  // sends the owner here to fix a specific quarter's bank gap; in August a Q1 blocker opened
  // Q2, every list read 0, and the honest conclusion was "this is already handled" — the worst
  // possible answer to a blocker. Same pattern the excluded-review link already uses. An
  // out-of-range or malformed pair falls through to 'auto' rather than showing an empty quarter.
  const yearParam = Number(searchParams.get('year'))
  const quarterParam = Number(searchParams.get('quarter'))
  const linkedQuarter =
    Number.isInteger(yearParam) && yearParam >= 2000 && yearParam <= 2100 &&
    Number.isInteger(quarterParam) && quarterParam >= 1 && quarterParam <= 4
      ? `${yearParam}-Q${quarterParam}`
      : null
  // [CIRKEL] ?quarter=all pins the all-quarters view. A cross-page jump ("bekijk bank" from the
  // match sheet) counts its pending work across ALL quarters, so landing it on 'auto' — the last
  // completed quarter — could show an empty list about a real count. 'all' can never be empty
  // about work that exists.
  const [quarterSel, setQuarterSel] = useState<string>(
    searchParams.get('quarter') === 'all' ? 'all' : linkedQuarter ?? 'auto'
  )
  // [BANK-IGNORE] Ignored transactions (status 'not_found'), loaded lazily when
  // the owner opens the "Genegeerd" tab.
  const [ignoredList, setIgnoredList] = useState<Suggestion[] | null>(null)

  // ── [BANK-WERK-EERST] De machinerie staat niet meer boven het werk ──────────────────────────
  //
  // Dit scherm heeft één taak voor de ondernemer: "welke bankregels wachten nog op mij, en laat me
  // ze afhandelen". Daarboven stonden negen blokken die alle drie over iets anders gaan — de
  // bankkoppeling, de sleepzone, de lijst geüploade afschriften met "Opnieuw matchen" en "Namen
  // bijwerken" ernaast, plus de uitkomst van elk daarvan. Op een telefoon (en dit bestand zegt in
  // zijn kop "mobile-first") is dat twee schermen scrollen vóór de eerste transactie.
  //
  // Geen ervan is overbodig: zonder afschrift is er niets te doen, en een verlopen koppeling moet
  // je kunnen herstellen. Maar ze beantwoorden allemaal de vraag HOE DE GEGEVENS HIER KOMEN, en die
  // vraag stelt de ondernemer één keer per maand — terwijl hij de vraag WAT MOET IK NOG DOEN elke
  // keer stelt dat hij dit scherm opent.
  //
  // Dus: is er werk, dan staat het werk bovenaan en vouwt de machinerie samen tot één regel met een
  // knop "Afschrift toevoegen" erin (uploaden blijft één tik). Is er nog niks, dan ÍS de machinerie
  // het scherm en staat alles open — dan is de sleepzone precies wat de ondernemer zoekt.
  //
  // `null` = nog niet beslist. De keuze valt zodra de eerste lezing binnen is en blijft daarna van
  // de ondernemer: klapt hij hem open, dan blijft hij open, ook na een herlezing.
  const [setupOpen, setSetupOpen] = useState<boolean | null>(null)


  // Shared matcher call — used by the initial load, after an upload, and (background:true) by the
  // tab-return refresh. [CIRKEL-C6] The body is guarded: mr.ok is checked BEFORE .json() (a
  // gateway's HTML 502 threw first), a network failure is caught (the visibility path fired it as
  // fire-and-forget → unhandled rejection → a Sentry event per alt-tab on a train), and a
  // background run fails SILENTLY — five tab switches must not stack five red toasts.
  const runMatch = useCallback(async (opts?: { background?: boolean }) => {
    const background = opts?.background === true
    let mrJson: MatchResponse
    try {
      const mr = await fetch('/api/bank/match')
      if (!mr.ok) {
        if (!background) showToast(t('bank.fout.matchen'))
        return
      }
      mrJson = (await mr.json()) as MatchResponse
    } catch {
      if (!background) showToast(t('bank.fout.matchen'))
      return
    }
    setData(mrJson)
    // Pre-fill 'auto' selections with their best candidate.
    const pre: Record<string, string> = {}
    for (const s of mrJson.suggestions) {
      if (s.outcome === 'auto' && s.best) pre[s.transactionId] = s.best.invoiceId
    }
    // [CIRKEL-C2] MERGE, owner first. Replacing wiped a manual pick on every refresh — and this
    // screen's primary verification action (Bekijk factuur) opens a NEW TAB, so coming back from
    // exactly that check fired the visibility refresh and reset the choice the owner just made.
    //
    // [CIRKEL-C2-PRUNE] But a kept pick must still EXIST in that line's fresh candidates. The
    // blind merge survived a pick whose invoice had just been booked elsewhere: the card then
    // rendered the fresh best candidate while the confirm button posted the stale id — booking a
    // different invoice than the screen showed, or (via the benign-409 path) stamping the line
    // "bevestigd" with nothing booked at all. Day-end audit finding; the pick only survives while
    // the matcher still offers it for that same line.
    setSelected((prev) => {
      const next: Record<string, string> = { ...pre }
      for (const s of mrJson.suggestions) {
        const kept = prev[s.transactionId]
        if (kept && s.candidates.some((c) => c.invoiceId === kept)) next[s.transactionId] = kept
      }
      return next
    })
  }, [showToast, t])

  // [BANK-UNLINK] Undo a confirmed match — makes auto-confirm safe (every booking reversible).
  const unlink = useCallback(async (txId: string, bedrag: number, aantalFacturen: number) => {
    // [GROTE-STAP] Ontkoppelen is not an untidy screen when it lands on the wrong row: a settled
    // invoice becomes open again, the balance reads higher than it is, and the owner is looking at
    // a bill they already paid. Below the threshold this still costs exactly one tap — a beat on
    // every unlink is clicked away on all of them, including the one that mattered.
    const oordeel = beoordeelStap({ soort: 'betaling_ontkoppelen', bedrag, aantal: aantalFacturen })
    const zin = groteStapZin({ soort: 'betaling_ontkoppelen', bedrag }, oordeel, eur.format)
    if (zin && !(await dialog.confirm({ message: zin, confirmLabel: t('bank.ontkoppelen') }))) return
    setProcessingId(txId)
    try {
      const res = await fetch('/api/bank/unlink', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: txId }),
      })
      const json = await res.json().catch(() => ({}))
      // [PARTIAL-PAY-INVARIANT] The unlink can succeed while the server fails to re-derive what is
      // still open on one of the invoices. That leaves the balance reading HIGHER than it is, which
      // is the direction that makes an owner pay the same money twice — so it gets the warning, not
      // the cheerful confirmation.
      if (res.ok) {
        await runMatch()
        showToast(json.balanceWarning ? String(json.balanceWarning) : t('bank.koppelingOngedaan'))
      }
      else if (json.error === 'verwerkt') showToast(t('bank.fout.verwerkt'))
      else if (json.error === 'multi_invoice_unlink_unsupported') showToast(t('bank.fout.groep'))
      else showToast(t('bank.fout.ontkoppelen'))
    } catch { showToast(t('bank.fout.ontkoppelen')) }
    finally { setProcessingId(null) }
  }, [runMatch, showToast, t, dialog])

  // [KAS-AUTO-BOOK] The other answer to the amber "even controleren" flag. Ontkoppelen says the
  // booking is wrong; this says it is right, and until now only the first had a button — so the
  // warning could never come down, on a screen whose whole value is that a warning means something.
  //
  // It clears auto_match_reason and touches nothing else: the link, the payment and the invoice
  // status are untouched, and Ontkoppelen still undoes the booking afterwards exactly as before.
  // So the worst case of a mis-tap is a flag lowered on a link that is still fully reversible.
  const markMatchChecked = useCallback(async (txId: string) => {
    setProcessingId(txId)
    try {
      const res = await fetch('/api/bank/match-checked', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionIds: [txId] }),
      })
      if (res.ok) {
        // Re-read rather than patching local state: the flag lives on the server row, and a card
        // that hides its own warning without the write having landed is the failure this whole
        // screen is built against.
        await runMatch()
        showToast(t('bank.gecontroleerd'))
      } else {
        showToast(t('bank.fout.opslaan'))
      }
    } catch { showToast(t('bank.fout.opslaan')) }
    finally { setProcessingId(null) }
  }, [runMatch, showToast, t])

  // [MOVE-PAYMENT] "This line is booked on the wrong invoice." The owner meets that realisation
  // from two directions and this is the second one: looking at the bank line, not at the invoice.
  // Ontkoppelen beside it answers a different question ("this booking should not exist") and
  // leaves the line unmatched, so using it here meant re-finding the same line afterwards and
  // booking it again — with the money on no invoice in between. Moving is one atomic step; the
  // server owns every rule (see /api/invoice/payment/move and move_invoice_payment).
  const openMove = useCallback(async (txId: string) => {
    setProcessingId(txId)
    try {
      const res = await fetch(`/api/invoice/payment/move?transactionId=${encodeURIComponent(txId)}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Includes the honest "this payment is split over several invoices" answer — ambiguous
        // here by nature, and better named than silently resolved to one of them.
        showToast(failureText(res.status, json, t('bank.fout.betalingenOphalen')))
        return
      }
      const payments = (json?.payments ?? []) as MovePayment[]
      if (payments.length === 0) { showToast(t('bank.fout.geenBoeking')); return }
      setMoveCtx({ txId, source: json.source as MoveSource, payments })
    } catch { showToast(t('bank.fout.offline')) }
    finally { setProcessingId(null) }
  }, [showToast, t])

  const doMove = useCallback(async (linkId: string, target: MoveTarget) => {
    setMoveCtx(null)
    try {
      const res = await fetch('/api/invoice/payment/move', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkId, targetInvoiceId: target.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The move is atomic, so a refusal means nothing changed — and the server's sentence says
        // which reason it was. Never our guess.
        showToast(failureText(res.status, json, t('bank.fout.verplaatsen')))
        return
      }
      await runMatch()
      showToast(target.invoice_number ? t('bank.verplaatstNaarFactuur', { number: target.invoice_number }) : t('bank.verplaatstNaarGekozen'))
    } catch { showToast(t('bank.fout.offlineNiets')) }
  }, [runMatch, showToast, t])

  // [BANK-AUTO-CONFIRM] Let the app handle the near-certain payments (reference number +
  // exact amount, single invoice) so the owner only deals with what's genuinely ambiguous.
  // The server decides the safe set (isSafeAutoConfirm); we just refresh afterwards.
  const autoConfirm = useCallback(async () => {
    setAutoRunning(true)
    try {
      const res = await fetch('/api/bank/auto-confirm', { method: 'POST' })
      const json = await res.json()
      if (res.ok) {
        setAutoDoneCount(json.count ?? 0)
        setKasRefusals((json.kasRefusals ?? null) as { filed_quarter?: number; unknown_filing?: number } | null)
        await runMatch() // the handled ones leave "Te bevestigen"
      } else {
        showToast(t('bank.fout.automatisch'))
      }
    } catch {
      showToast(t('bank.fout.automatisch'))
    } finally {
      setAutoRunning(false)
    }
  }, [runMatch, showToast, t])

  // [BANK-AUTO-RUN] The circle should run itself: when the matches load and the app finds
  // near-certain payments (invoice number printed in the statement + exact amount, single
  // invoice, no instalment hint), it books them WITHOUT waiting for a tap. This is the
  // difference between the owner chasing the app and the app working in the background.
  // The server (isSafeAutoConfirm) is authoritative and only ever touches that safe set;
  // this effect just decides "are there any, and have I not run yet this load". autoRanRef
  // makes it once-per-mount so the runMatch refresh inside autoConfirm can't loop it.
  useEffect(() => {
    if (autoRanRef.current) return
    if (autoRunning) return
    if (!data) return
    // [BANK-IBAN] "Are there any safe matches worth calling autoConfirm for right now?" — the
    // shared predicate, so this gate and the counter that reports it can never answer differently
    // (they did: an invoice matched purely on supplier IBAN + exact sum, e.g. the HVO invoices
    // with no printed number, tripped this gate but was counted as zero on screen).
    const hasSafe = (data.suggestions ?? []).some(isServerAutoBookable)
    // [BANK-BATCH-ONLOAD] Also fire the pass when an unresolved MULTI-invoice batch exists (a
    // wholesaler debiting a week of deliveries into one payment, e.g. "sumer food … 2 facturen").
    // The single-match gate above deliberately skips these (>1 reference), so a statement whose
    // ONLY auto-bookable payments were exact batches never auto-confirmed on page-open — it waited
    // for the daily cron. runBankAutoConfirm already runs the batch pass; the server's
    // planBatchAutoConfirm stays authoritative (books ONLY provably-exact ties: every number →
    // exactly one unpaid invoice, one supplier, sum to the cent). This just decides "is it worth
    // calling now". A non-tie / incomplete batch simply books nothing — the call is idempotent.
    const hasBatch = (data.suggestions ?? []).some((s) => {
      const refCount = parseReferenceNumbers(s.reference).length // [BANK-REF-ONE-SOURCE]
      if (refCount < 2) return false
      if (s.allCovered === true || confirmed[s.transactionId]?.allCovered === true) return false
      return true
    })
    if (!hasSafe && !hasBatch) return
    autoRanRef.current = true
    void (async () => { await autoConfirm() })()
  }, [data, autoRunning, autoConfirm])

  // [CIRKEL] A tab left open here while the owner pays on Crediteuren kept offering the
  // settled invoice until a manual reload — every in-page action re-runs the matcher, only
  // cross-page mutations didn't. Re-run when the tab becomes visible again.
  // [CIRKEL-P4] The refresh may never TRIGGER money: fresh data feeds the once-per-mount
  // auto-confirm effect, and if the first load had nothing safe that gate was still open — so a
  // mere tab switch could book. The ref closes the gate before the background data arrives.
  // In-flight guard: ten alt-tabs must be one request, not ten concurrent 13-second calls
  // whose stale responses race each other into setData.
  const visRefreshBusy = useRef(false)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || visRefreshBusy.current) return
      visRefreshBusy.current = true
      autoRanRef.current = true
      void runMatch({ background: true }).finally(() => { visRefreshBusy.current = false })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [runMatch])

  // [BANK-PERSIST] Initial load — show stored pending transactions on refresh.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const mr = await fetch('/api/bank/match')
        const mrJson: MatchResponse = await mr.json()
        if (cancelled) return
        if (mr.ok) {
          setData(mrJson)
          const pre: Record<string, string> = {}
          for (const s of mrJson.suggestions) {
            // [AL-GEBOEKT-KLEMT] Pre-selecting the winner is what makes "Bevestig betaling" one tap.
            // It may not be one tap once quotedSettled is set: the payment then names an invoice that
            // is already booked, and every candidate under it is a DIFFERENT, still-open invoice. That
            // is the card from the screenshot — a green check over a bill the statement never named,
            // with a live confirm below it. Tapping a candidate still selects it; only the accident goes.
            if (s.outcome === 'auto' && s.best && !s.quotedSettled) pre[s.transactionId] = s.best.invoiceId
          }
          setSelected(pre)
        }
        // [BANK-IGNORE] Also load ignored up front so the Genegeerd tab (and the
        // tab bar) appears even when every transaction has been ignored.
        const ig = await fetch('/api/bank/ignored')
        const igJson = await ig.json()
        if (!cancelled && ig.ok) setIgnoredList(igJson.suggestions ?? [])
        // [P1-UNCATEGORIZED] The exact head-count of still-uncategorized bank lines.
        const cat = await fetch('/api/bank/categorize')
        const catJson = await cat.json().catch(() => ({}))
        if (!cancelled && cat.ok) {
          setUncatCount(Number(catJson.total_remaining ?? 0) || 0)
          setUncatOut(typeof catJson.remaining_out === 'number' ? catJson.remaining_out : null)
          setUncatIn(typeof catJson.remaining_in === 'number' ? catJson.remaining_in : null)
        }
      } catch {
        /* silent — empty state shows the upload card */
      } finally {
        if (!cancelled) setInitialLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ── Upload → match ──────────────────────────────────────────────────────────
  // [BANK-DND] handleFile is the <input onChange> wrapper; the real work lives in
  // processFile(file) so the drag-and-drop path can reuse the exact same logic
  // (upload → match → refresh) without duplication.
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    await processFile(file)
  }

  async function processFile(file: File) {
    if (busy) return // ignore a second file while one is uploading

    setBusy(true)
    setUploadInfo(null)
    setData(null)
    setConfirmed({})
    setSelected({})

    try {
      const form = new FormData()
      form.append('file', file)
      const up = await fetch('/api/bank/upload', { method: 'POST', body: form })
      const upJson = await up.json()
      if (!up.ok) {
        showToast(upJson?.error === 'no_transactions' ? t('bank.fout.geenTransacties') : t('bank.fout.uploaden'))
        setBusy(false)
        return
      }
      // [R2] parseWarnings = statement lines the parser could not read. Each one is a
      // transaction that is NOT in the overview (the raw file still reaches the accountant).
      // The UI dropped this field, so the owner was never told a line went missing.
      setUploadInfo({ format: upJson.format, parsed: upJson.parsed, inserted: upJson.inserted, skipped: upJson.skipped, unreadable: Array.isArray(upJson.parseWarnings) ? upJson.parseWarnings.length : 0, autoBooked: upJson.autoBooked ?? 0, balanceWarning: upJson.balanceWarning ?? null, continuityWarning: upJson.continuityWarning ?? null, balanceReconciliation: upJson.balanceReconciliation ?? null })
      // [BANK-BALANCE §2.6] A statement that doesn't tie out to its own begin/eindsaldo is INCOMPLETE
      // — a bank line is missing/dropped. This is a money-truth gap; make it loud (toast now, banner
      // below), never buried, so the owner re-uploads the full afschrift before trusting the figures.
      if (upJson.balanceWarning) showToast(t('bank.waarschuwing.sluitNiet'))
      // [STATEMENT-CONTINUITY] …en of er een heel AFSCHRIFT ontbreekt tussen dit bestand en het
      // vorige. Dat is precies het gat dat je in de bestanden die je WEL hebt nooit ziet: die
      // kloppen allebei. Nu melden, want de eigenaar heeft zijn bankportaal op dit moment open.
      else if (upJson.continuityWarning) showToast(t('bank.waarschuwing.gat'))
      // [BANK-AUTO-FEEDBACK] Tell the owner right away when the import already booked payments for
      // them — the money moved silently on the server; a toast makes the automatic work visible.
      if ((upJson.autoBooked ?? 0) > 0) {
        showToast(upJson.autoBooked === 1 ? t('bank.autoGeboektEen') : t('bank.autoGeboekt', { count: upJson.autoBooked }))
      }

      // [BANK-FORMAT-GUARD] The file is always stored for the accountant (the
      // server keeps a passthrough copy regardless of format). But a PDF — or
      // any file that yielded no transactions — could NOT be read into the bank
      // overview. Tell the owner clearly with a modal so they don't assume their
      // transactions were imported, and point them to the readable formats. We
      // still refresh the statements table below so the stored file appears.
      const unreadable = !isReadableBankFile(file.name) || (upJson.parsed ?? 0) === 0
      if (unreadable) {
        setFormatNotice({ name: file.name, kept: true })
      }

      // [BANK-AUTO-RUN] Claim the once-per-load guard BEFORE the awaits below. runMatch()
      // populates `data`, and React can commit that render during the very next await — if the
      // guard were still false the load effect would fire its own autoConfirm() there, then we
      // would fire a second one, racing two passes. Setting it first makes the load effect
      // short-circuit so this upload owns exactly one pass.
      autoRanRef.current = true
      // Run matching (shared with initial load) — always, so `data` is populated even if
      // the auto-confirm pass below finds nothing or fails (the screen must never stay empty).
      await runMatch()
      // [BANK-STATEMENT-DELETE] Refresh the uploaded-statements table so the file
      // just uploaded appears immediately — without it the table only updated on a
      // full page reload (it's populated by loadStatements on mount).
      await loadStatements()
      // Book the near-certain payments from the statement we just uploaded, right now — the
      // owner shouldn't have to reload for the app to handle the sure ones. The server books
      // only the safe set (isSafeAutoConfirm); an empty or failed pass leaves the list as-is.
      await autoConfirm()
    } catch {
      showToast(t('bank.fout.algemeen'))
    } finally {
      setBusy(false)
    }
  }

  // [BANK-DND] Drag-and-drop onto the upload zone. preventDefault on dragOver is
  // required for the browser to fire a drop; without it the file just opens in a
  // new tab. We take the first dropped file and run the same processFile path.
  function onDropZone(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(false)
    if (busy) return
    const file = e.dataTransfer.files?.[0]
    if (file) void processFile(file)
  }
  function onDragOverZone(e: React.DragEvent) {
    e.preventDefault()
    if (!busy && !dragActive) setDragActive(true)
  }
  function onDragLeaveZone(e: React.DragEvent) {
    e.preventDefault()
    setDragActive(false)
  }

  // ── Confirm one match ─────────────────────────────────────────────────────────
  // [BANK-MULTI-CONFIRM] A transaction may list several invoice numbers. Confirming
  // one pays + links it, but the transaction only leaves "Te bevestigen" when the
  // backend reports allCovered (every reference number now has a paid invoice). We
  // append the confirmed number to this tx's list and carry allCovered through.
  // `explicitInvoiceId` lets the multi-invoice rows pass the invoice id directly,
  // avoiding the setSelected→confirm race (state updates are async; reading
  // selected[txId] right after onSelect would see the stale value).
  // [SHADOW] Named confirmMatch, not confirm: a local function called `confirm`
  // shadows window.confirm for the whole module, so anyone later reaching for
  // the browser dialog here would silently have called this instead.
  // [BANK-SPLIT] `opts.amount` = how much of this bank line goes on THIS invoice, when the owner
  // says so; absent means "everything it has left", which is what every call sent before.
  // [DECLARED-INVOICE] `opts.force` = the owner saw the "this payment also names factuur X" warning
  // and chose to book anyway.
  async function confirmMatch(
    txId: string,
    invoiceNumber: string | null,
    explicitInvoiceId?: string,
    opts?: { amount?: number; force?: boolean },
  ) {
    const invoiceId = explicitInvoiceId ?? selected[txId]
    if (!invoiceId) return
    setProcessingId(txId)
    try {
      const res = await fetch('/api/bank/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: txId,
          invoiceId,
          ...(opts?.amount != null ? { amount: opts.amount } : {}),
          ...(opts?.force ? { force: true } : {}),
        }),
      })
      const json = await res.json()
      if (res.ok) {
        const allCovered = json?.allCovered !== false // default true (single-invoice case)
        setConfirmed((c) => {
          const prev = c[txId]?.numbers ?? []
          const num = invoiceNumber ?? ''
          const numbers = num && !prev.includes(num) ? [...prev, num] : prev
          return { ...c, [txId]: { numbers, allCovered } }
        })
        // Clear the selection so a multi-invoice tx doesn't keep the just-paid
        // invoice pre-selected for the next open number.
        setSelected((sel) => {
          const next = { ...sel }
          delete next[txId]
          return next
        })
        // [PARTIAL-PAY] /api/bank/confirm returns {partial, applied, remaining} when the payment
        // only settled PART of the invoice. Reporting "gemarkeerd als betaald ✓" then is simply
        // untrue — the invoice is still open for the rest. Say what actually happened.
        const isPartial = json?.partial === true
        const remainingOpen = typeof json?.remaining === 'number' ? json.remaining : null
        showToast(
          json?.warning === 'transaction_link_failed'
            ? t('bank.betaaldKoppelingLater')
            // [LINKS-WRITE-HONEST] De factuur IS betaald — maar de regel waaruit de bankpagina
            // afleest of deze banktransactie klaar is, is niet weggeschreven. Zonder die regel valt
            // /api/bank/match terug op het tellen van factuurnummers in de omschrijving, en een
            // betaling met een klant- of ordernummer erin verdwijnt dan nooit uit "Te bevestigen":
            // nog een keer bevestigen levert 409, dit scherm leest dat als klaar en haalt opnieuw
            // op, en de kaart staat er meteen weer. Dat is precies de lus waar dit bericht voor is.
            // Zeggen dat het gelukt is en de ondernemer die lus in laten lopen, is het ergste van
            // de twee: hij tikt dan tien keer op een knop die niets meer kan doen.
            : json?.warning === 'payment_link_not_recorded'
              ? t('bank.betaaldNietVastgelegd')
              : isPartial
              ? (remainingOpen != null
                  ? t('bank.deelGeboektOpen', { amount: eur.format(remainingOpen) })
                  : t('bank.deelGeboektBlijft'))
              : allCovered
                ? t('bank.bevestigdBetaald')
                : t('bank.betaaldNogEenOpen')
        )
        // [BANK-MULTI-CONFIRM] Re-run matching so the just-paid invoice drops out of
        // the candidate list and any remaining open number is re-evaluated. Without
        // this the paid invoice would linger as a still-selectable candidate.
        // [PARTIAL-PAY] Also after a DEELBETALING: the invoice stays in the pool but its
        // remaining balance just shrank, and scorePair targets that remaining. Without a
        // re-match, another pending line for the same invoice would still be scored (and
        // warned about) against the old, larger balance.
        if (!allCovered || isPartial) await runMatch()
      } else if (json?.error === 'declared_invoice_missing') {
        // [DECLARED-INVOICE] The payment names an invoice we do not have, and booking the whole
        // line here would spend its money. Nothing was written — ask, do not guess.
        setSplitCtx({
          txId,
          invoiceId,
          invoiceNumber: invoiceNumber ?? null,
          missingNumbers: (json.missingNumbers ?? []) as string[],
          // [SERVER-ZIN] Deze string wordt als tekst getoond (de <p> in het splitsvenster), dus
          // hij gaat door dezelfde regel als elke andere servermelding.
          detail: failureText(res.status, json, ''),
        })
      } else if (json?.error === 'bad_allocation') {
        // [BANK-SPLIT] The stated amount does not fit. The server names which ceiling it hit.
        showToast(failureText(res.status, json, t('bank.fout.bedragPastNiet')))
      } else if (json?.error === 'verwerkt') {
        setVerwerktCtx({ number: json.invoiceNumber ?? invoiceNumber ?? '' })
      } else if (res.status === 409 && json?.error === 'payment_fully_applied') {
        // [BANK-ONE-PAYMENT-MANY-INVOICES] Every euro of this line is already on other invoices,
        // so there is nothing left to book here. Not a failure — a full wallet, honestly reported.
        showToast(t('bank.fout.alToegewezen'))
        await runMatch()
      } else if (res.status === 409 && (json?.error === 'invoice_already_paid' || json?.error === 'transaction_already_processed')) {
        // [BANK-409-BENIGN] Already booked — the auto-confirm on page-open (or another tab) got
        // there first. That IS the desired outcome, so mark it done + refresh so it leaves the
        // list, never a red "mislukt". The money is correct and reversible under Bevestigd.
        setConfirmed((c) => ({ ...c, [txId]: { numbers: invoiceNumber ? [invoiceNumber] : [], allCovered: true } }))
        showToast(t('bank.alBevestigd'))
        await runMatch()
      } else {
        showToast(t('bank.fout.bevestigen'))
      }
    } catch {
      showToast(t('bank.fout.algemeen'))
    } finally {
      setProcessingId(null)
    }
  }

  // [BANK-SUM-SUGGEST] Book a suggested same-supplier sum: each invoice through the SAME
  // guarded /api/bank/confirm, sequentially (the money arithmetic allocates: every booking
  // spends only what the line still has, and the last one closes it). No new write path —
  // the suggestion is only a pre-computed answer to "which invoices?", never its own booking.
  // [SOM-KLOPT-ÉÉN] …and it is now ONE request: the route books the set through book_bank_batch,
  // which re-proves the tie on the current rows, signs a creditnota negative and books all or
  // nothing. The loop this replaced could not book a netted creditnota in either order, and
  // reported "2 samen gekoppeld" over an invoice it had left € 52,38 open.
  async function confirmSumMatch(txId: string, invoiceIds: string[]) {
    setProcessingId(txId)
    try {
      const res = await fetch('/api/bank/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: txId, invoiceIds }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) showToast(t('bank.samenGekoppeld', { count: invoiceIds.length }))
      else if (res.status === 409 && json?.error === 'transaction_already_processed') showToast(t('bank.samenGekoppeld', { count: invoiceIds.length }))
      else if (res.status === 409 && json?.error === 'batch_tie_broken') showToast(t('bank.somVeranderd'))
      else showToast(failureText(res.status, json, t('bank.fout.bevestigen')))
      await runMatch()
    } catch {
      showToast(t('bank.fout.algemeen'))
    } finally {
      setProcessingId(null)
    }
  }

  // [BANK-BATCH-CONFIRM] A transaction is batch-eligible only when it is a strong,
  // single-invoice 'auto' match that already has a best candidate pre-selected and
  // is not partially linked / not multi-number. These are the ones the owner can
  // safely tick and confirm together; everything else keeps its single-confirm flow.
  function isBatchEligible(s: Suggestion): boolean {
    if (s.outcome !== 'auto' || !s.best) return false
    if (isPartiallyLinked(s)) return false
    // Multi-invoice (reference lists >1 number) → per-number action, never bulk.
    // [BANK-REF-ONE-SOURCE] Counted by the shared parser, so the card, this gate and the server
    // can never disagree about how many invoices a reference names.
    const refCount = parseReferenceNumbers(s.reference).length
    if (refCount > 1) return false
    if (confirmed[s.transactionId]) return false // already acted on this session
    return true
  }

  // [BANK-BATCH-CONFIRM] Confirm every ticked transaction, sequentially, reusing the
  // SAME /api/bank/confirm endpoint (no batch endpoint, no backend change). Sequential
  // (not Promise.all) keeps each payment's session-client auth + B.4 guard intact and
  // makes partial failure easy to report. We do NOT call confirmMatch() in the loop (it would
  // run runMatch after each one and mutate the list mid-iteration); instead we POST
  // directly, collect results, then refresh ONCE at the end.
  async function confirmBatch() {
    const targets = toConfirm.filter(
      (s) => selectedForBatch.has(s.transactionId) && isBatchEligible(s)
    )
    if (targets.length === 0) return
    setBatchRunning(true)
    let ok = 0
    let failed = 0
    try {
      for (const s of targets) {
        const invoiceId = selected[s.transactionId] ?? s.best?.invoiceId
        if (!invoiceId) {
          failed++
          continue
        }
        setProcessingId(s.transactionId)
        try {
          const res = await fetch('/api/bank/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactionId: s.transactionId, invoiceId }),
          })
          const json = await res.json()
          // [BANK-BATCH-409] A 409 "already processed / already paid" is NOT a failure — it means
          // this payment is ALREADY booked (the auto-confirm on page-open, or a concurrent tab, got
          // there first). That is exactly what the owner wanted, so treat it as done and let it drop
          // out of the list. Only a REAL block (accountant 'verwerkt', not_eligible) counts as failed.
          const alreadyDone = res.status === 409 && (json?.error === 'transaction_already_processed' || json?.error === 'invoice_already_paid')
          if (res.ok || alreadyDone) {
            ok++
            const num = s.best?.invoiceNumber ?? ''
            const allCovered = json?.allCovered !== false
            setConfirmed((c) => ({ ...c, [s.transactionId]: { numbers: num ? [num] : [], allCovered } }))
          } else {
            failed++
          }
        } catch {
          failed++
        }
      }
    } finally {
      setProcessingId(null)
      setSelectedForBatch(new Set())
      setBatchRunning(false)
      // Refresh once: just-paid invoices drop out of candidates, lists re-derive.
      // The refresh must never eat the RESULT. runMatch parses the response body before it
      // checks res.ok, so a gateway answering with an HTML error page throws — and thrown from
      // a `finally` that means the summary below never runs: the owner just confirmed a stack of
      // payments, every one of them booked, and the screen says nothing at all. The refresh is a
      // convenience; the count is the answer. Report it either way.
      let refreshed = true
      try {
        await runMatch()
      } catch {
        refreshed = false
      }
      showToast(
        (failed === 0
          ? t('bank.batchBevestigd', { count: ok })
          : t('bank.batchDeels', { ok, failed })) +
        (refreshed ? '' : ` · ${t('bank.vernieuwLijst')}`),
      )
    }
  }
  // transaction → backend creates a paid incoming invoice from it and links it.
  // [BANK-STATEMENTS] Load the uploaded statements list.
  const loadStatements = useCallback(async () => {
    try {
      const res = await fetch('/api/bank/statements')
      const json = await res.json()
      if (res.ok && json?.ok) setStatements(json.statements)
    } catch {
      /* silent — the table just stays hidden */
    }
  }, [])

  useEffect(() => { loadStatements() }, [loadStatements])

  // [BANK-REDERIVE] Upgrade older rows whose name is still "Onbekende" by
  // re-deriving from their stored description. Refreshes the list afterwards.
  async function refreshNames() {
    setRefreshingNames(true)
    try {
      const res = await fetch('/api/bank/refresh-names', { method: 'POST' })
      const json = await res.json()
      if (res.ok && json?.ok) {
        showToast(
          json.updated > 0
            ? (json.updated === 1 ? t('bank.namenBijgewerktEen') : t('bank.namenBijgewerkt', { count: json.updated }))
            : t('bank.namenUpToDate')
        )
        await runMatch()
      } else {
        showToast(t('bank.fout.bijwerken'))
      }
    } catch {
      showToast(t('bank.fout.algemeen'))
    } finally {
      setRefreshingNames(false)
    }
  }

  // [BANK-REMATCH] "Probeer alles opnieuw" — the one thing the page cannot do by itself.
  //
  // A 'pending' line is already re-scored against every open invoice on every load, so nothing
  // rots there. A line the owner set aside is a different story: /api/bank/match reads
  // status='pending' only, so "Genegeerd" is a one-way door. And the reason a payment gets
  // ignored is almost always that the invoice was missing — when it finally arrives, that line
  // is the only one in the app that cannot notice.
  //
  // The server restores a line ONLY when the matcher now gives it a single clear winner and no
  // active line is working on that invoice; anything weaker is reported, never acted on. So the
  // toast has to be honest about three different outcomes, including "found something, left it
  // alone" — a silent "0 hersteld" would read as "nothing to find" and send the owner away.
  async function forceRematch() {
    setRematching(true)
    try {
      const res = await fetch('/api/bank/rematch', { method: 'POST' })
      const json = await res.json()
      if (res.status === 429) {
        showToast(t('bank.fout.netGedaan'))
        return
      }
      if (!res.ok || !json?.ok) {
        showToast(t('bank.fout.opnieuw'))
        return
      }
      setRematchInfo({ restored: json.restored ?? 0, booked: json.booked ?? 0, ambiguous: json.ambiguous ?? 0, examined: json.examined ?? 0, supplierIbansUnavailable: json.supplierIbansUnavailable === true })
      const parts: string[] = []
      if (json.restored > 0) parts.push(json.restored === 1 ? t('bank.rematch.terugEen') : t('bank.rematch.terug', { count: json.restored }))
      if (json.booked > 0) parts.push(t('bank.rematch.gekoppeld', { count: json.booked }))
      showToast(
        parts.length > 0
          ? `${parts.join(' · ')} ✓`
          : json.ambiguous > 0
            ? (json.ambiguous === 1 ? t('bank.rematch.zwakEen') : t('bank.rematch.zwak', { count: json.ambiguous }))
            : t('bank.rematch.niets', { count: json.examined }),
      )
      await runMatch()
      await loadIgnored()
    } catch {
      showToast(t('bank.fout.algemeen'))
    } finally {
      setRematching(false)
    }
  }

  // [BANK-STATEMENT-DELETE] Delete a bank statement file the owner uploaded by
  // mistake (wrong file, or a period that overlaps an existing statement). This
  // removes the documents row + the Storage file (server-side); bank_transactions
  // are NEVER touched, so every linked invoice / confirmed payment / ignore is
  // preserved. The statement disappears from the next closing-package ZIP because
  // the package is built fresh from the documents query. Confirmation is required
  // (the delete is permanent) — this runs only after the dialog is confirmed.
  async function deleteStatement(documentId: string) {
    setDeletingStatementId(documentId)
    try {
      const res = await fetch('/api/bank/delete-statement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      })
      const json = await res.json()
      if (res.ok && json?.ok) {
        // Drop the row from the list immediately.
        setStatements((prev) => (prev ? prev.filter((st) => st.id !== documentId) : prev))
        showToast(t('bank.afschrift.verwijderd'))
      } else {
        // [SERVER-ZIN] `json?.error` showed lookup_failed when the document read failed.
        showToast(failureText(res.status, json, t('bank.fout.algemeen')))
      }
    } catch {
      showToast(t('bank.fout.algemeen'))
    } finally {
      setDeletingStatementId(null)
      setStatementToDelete(null)
    }
  }


  // [BANK-INVOICE-FILE] Open the actual PDF of a matched invoice in a new tab so
  // the owner can check it before confirming the payment. Fetches a short-lived
  // signed URL; opens the tab synchronously first (so the browser doesn't block
  // the popup) and points it at the URL once it arrives.
  async function openInvoiceFile(invoiceId: string) {
    const tab = window.open('', '_blank')
    try {
      const res = await fetch(`/api/bank/invoice-file?invoiceId=${encodeURIComponent(invoiceId)}`)
      const json = await res.json()
      if (res.ok && json?.url) {
        if (tab) tab.location.href = json.url
        else window.open(json.url, '_blank')
      } else {
        if (tab) tab.close()
        // [SERVER-ZIN] Was: `json?.detail || json?.error === 'no_file' ? A : B`. `||` bindt losser
        // dan `===`, dus de hele linkerkant was de CONDITIE — een niet-lege detail liet de toast
        // "geen bestand" zeggen, wat de reden ook was. Nu expliciet: eerst de code die we kennen,
        // dan de zin van de server als het er een is, dan de eigen regel.
        showToast(
          json?.error === 'no_file'
            ? t('bank.fout.geenBestand')
            : failureText(res.status, json, t('bank.fout.factuurOpenen')),
        )
      }
    } catch {
      if (tab) tab.close()
      showToast(t('bank.fout.factuurOpenen'))
    }
  }

  // [FULL-CORRECTION] Open the SAME editor the pay screen uses. Fetching first means the dialog
  // can refuse to open on an invoice the server would reject anyway — an owner who types a
  // correction into a form that then rejects it was misled by the screen, not by the server.
  async function openCorrection(invoiceId: string) {
    try {
      const res = await fetch(`/api/invoice/${invoiceId}/amounts`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        showToast(failureText(res.status, json, t('bank.fout.factuurNietOpgehaald')))
        return
      }
      if (!json.editable) {
        // The server already phrased the way out; repeating it verbatim keeps one explanation.
        showToast(String(json.reason ?? t('bank.fout.nietCorrigeren')))
        return
      }
      setCorrectBtwRows(Array.isArray(json.btwRows) ? (json.btwRows as BtwSplitRow[]) : null)
      setCorrectDeposit((json.depositGap as DepositGap | null) ?? null)
      setCorrectHint(typeof json.readingHint === 'string' ? json.readingHint : null)
      setCorrectFor(json.invoice as CorrectableInvoice)
    } catch {
      showToast(t('bank.fout.factuurOphalen'))
    }
  }

  // [DECLARED-INVOICE] Add the invoice the payment NAMES but the administration does not have,
  // without leaving the screen.
  //
  // Deliberately NOT through /api/bank/attach-invoice, which is the other obvious choice and the
  // wrong one here. That route exists for "this bank line IS this invoice": when the read total
  // disagrees with the bank amount it trusts the bank, on the sound reasoning that the money which
  // moved is the truth. On a line that pays TWO invoices that reasoning inverts — attaching an
  // €800 invoice to a €2.265,41 line would create an €2.265,41 invoice and consume the whole line.
  //
  // The normal intake keeps the paper's own total, which is the only figure that can be right here.
  // The invoice then lands where every other invoice lands, and the owner allocates afterwards.
  async function addMissingInvoice(file: File) {
    setAddingMissing(true)
    try {
      // [UPLOAD-PLAFOND] A photographed or scanned invoice is exactly the file that overruns the
      // platform's body limit. Fitted and, if the platform still refuses, sent again smaller.
      const { response: res } = await sendWithFit(file, (f) => {
        const fd = new FormData()
        fd.append('file', f)
        return fetch('/api/intake', { method: 'POST', body: fd })
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        showToast(failureText(res.status, json, t('bank.fout.toevoegenNiets')))
        return
      }
      const landedAsInvoice = json.destination === 'invoice' || json.destination === 'receipt'
      if (!landedAsInvoice) {
        // A statement, or a document we could not read as an invoice. Say what it became rather
        // than implying the payment can now be split.
        showToast(t('bank.bestandNietHerkend'))
        return
      }
      if (json.auto_verified) {
        // Booked. Re-match so it becomes selectable on THIS line straight away.
        await runMatch()
        showToast(t('bank.toegevoegdGeboekt'))
      } else {
        // In the verify queue. Do NOT pretend it is ready: the split cannot reach it yet.
        showToast(t('bank.toegevoegdWachtrij'))
      }
    } catch {
      showToast(t('bank.fout.toevoegen'))
    } finally {
      setAddingMissing(false)
    }
  }

  async function attachFile(txId: string, files: File[], isCredit: boolean) {
    setProcessingId(txId)
    try {
      let ok = 0
      let lastMsg = ''
      // Upload each file → each becomes one paid invoice linked to this tx. The
      // backend only marks the transaction 'matched' once the linked invoices'
      // total covers the transaction amount (fixes the multi-invoice disappear
      // bug: confirming one of three must not hide the rest).
      for (const file of files) {
        // [UPLOAD-PLAFOND] Same fit as every other document path; without it a scanned bill
        // attached to a transaction met a bare platform 413 with no sentence at all.
        const postAttach = async (force: boolean) => {
          const { response: r } = await sendWithFit(file, (f) => {
            const form = new FormData()
            form.append('file', f)
            form.append('transactionId', txId)
            form.append('direction', isCredit ? 'outgoing' : 'incoming')
            if (force) form.append('force', 'true')
            return fetch('/api/bank/attach-invoice', { method: 'POST', body: form })
          })
          return { r, j: await r.json() }
        }
        let { r: res, j: json } = await postAttach(false)
        // [DEDUP-SOFT] A possible-duplicate is UNCERTAIN — surface it as a decision, never a silent
        // block or a silent double-book. The owner confirms it is a different bill → re-send with force.
        if (res.status === 409 && json?.duplicate && json?.canForce) {
          // [DEDUP-SOFT] This is a decision about money: the server thinks this
          // bill may already be booked. The browser's box put the server's
          // explanation and the question in one undifferentiated blob of text.
          // Here the detail is the body and the question is the title, so the
          // owner reads WHY before deciding.
          const proceed = await dialog.confirm({
            title: t('bank.tochKoppelenVraag'),
            message: failureText(res.status, json, t('bank.lijktDubbel')),
            confirmLabel: t('bank.jaTochKoppelen'),
            cancelLabel: t('bank.overslaan'),
            danger: true,
          })
          if (!proceed) { lastMsg = t('bank.overgeslagenDubbel'); continue }
          ;({ r: res, j: json } = await postAttach(true))
        }
        if (res.ok) {
          ok++
          if (json?.amountWarning) lastMsg = t('bank.controleerBedrag')
        } else {
          lastMsg = failureText(res.status, json, t('bank.fout.koppelen'))
        }
      }
      if (ok > 0) {
        showToast(
          ok === files.length
            ? `${ok === 1 ? t('bank.gekoppeldEen') : t('bank.gekoppeldMeer', { count: ok })}${lastMsg ? ` ${lastMsg}` : ''}`
            : `${t('bank.gekoppeldDeels', { ok, total: files.length })} ${lastMsg}`
        )
      } else {
        showToast(lastMsg || t('bank.fout.koppelen'))
      }
      await runMatch() // refresh: tx leaves "Geen factuur" only if fully accounted
    } catch {
      showToast(t('bank.fout.algemeen'))
    } finally {
      setProcessingId(null)
    }
  }

  // [BANK-IGNORE] Fetch the ignored (not_found) transactions for the Genegeerd tab.
  const loadIgnored = useCallback(async () => {
    try {
      const res = await fetch('/api/bank/ignored')
      const json = await res.json()
      if (res.ok) setIgnoredList(json.suggestions ?? [])
      else setIgnoredList([])
    } catch {
      setIgnoredList([])
    }
  }, [])

  // [BANK-IGNORE] Ignore a transaction: pending → not_found. It leaves the active
  // list (match only reads pending) and appears under Genegeerd.
  // [BIJLAGE-BIJ-REGEL] A file WITH the line — never a booking. The list on the card comes from
  // the same route that lists the line, so after a change the list is simply reloaded.
  async function addAttachment(txId: string, file: File) {
    if (file.size > 15 * 1024 * 1024) { showToast(t('bank.bijlage.teGroot')); return }
    setProcessingId(txId)
    try {
      // [UPLOAD-PLAFOND] Through the shared fit, like every browser upload of a document: a large
      // scan is shrunk to the platform's ceiling and retried, never refused with a bare 413.
      const { response: res } = await sendWithFit(file, (f) => {
        const fd = new FormData()
        fd.append('transactionId', txId)
        fd.append('file', f)
        return fetch('/api/bank/attachment', { method: 'POST', body: fd })
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) showToast(t('bank.bijlage.toegevoegd'))
      else if (res.status === 415) showToast(t('bank.bijlage.soort'))
      else if (res.status === 413) showToast(t('bank.bijlage.teGroot'))
      else showToast(failureText(res.status, json, t('bank.fout.bijlage')))
      await runMatch()
      await loadIgnored()
    } catch {
      showToast(t('bank.fout.algemeen'))
    } finally {
      setProcessingId(null)
    }
  }
  async function removeAttachment(txId: string, a: BankAttachment) {
    setProcessingId(txId)
    try {
      const res = await fetch('/api/bank/attachment', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id }) })
      showToast(res.ok ? t('bank.bijlage.weg') : t('bank.fout.bijlage'))
      await runMatch()
      await loadIgnored()
    } catch {
      showToast(t('bank.fout.algemeen'))
    } finally {
      setProcessingId(null)
    }
  }
  async function openAttachment(txId: string, a: BankAttachment) {
    try {
      const res = await fetch(`/api/bank/attachment?transactionId=${encodeURIComponent(txId)}`)
      const json = await res.json().catch(() => ({}))
      const hit = (json?.attachments as { id: string; url: string | null }[] | undefined)?.find((x) => x.id === a.id)
      if (hit?.url) window.open(hit.url, '_blank', 'noopener')
      else showToast(t('bank.fout.bijlage'))
    } catch {
      showToast(t('bank.fout.algemeen'))
    }
  }
  // [REGEL-FACTUUR] "Say what this payment was": the prefill comes from the server (the party,
  // the amount, the rate this supplier's invoices show), the owner answers three things, the
  // server applies the money rule (no btw on a purchase without a document) and links the line.
  const [lijnFactuur, setLijnFactuur] = useState<LijnFactuurPrefill | null>(null)
  async function openLijnFactuur(txId: string) {
    setProcessingId(txId)
    try {
      const res = await fetch(`/api/bank/line-invoice?transactionId=${encodeURIComponent(txId)}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json?.prefill) { showToast(failureText(res.status, json, t('bank.fout.lijnFactuur'))); return }
      setLijnFactuur(json.prefill as LijnFactuurPrefill)
    } catch {
      showToast(t('bank.fout.algemeen'))
    } finally {
      setProcessingId(null)
    }
  }
  async function submitLijnFactuur(input: { rate: 0 | 9 | 21; hasDocumentElsewhere: boolean; clientName: string; description: string }) {
    if (!lijnFactuur) return
    const txId = lijnFactuur.transactionId
    setProcessingId(txId)
    try {
      const res = await fetch('/api/bank/line-invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: txId, ...input }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        showToast(json?.btwWithheldNoDocument ? t('bank.lf.klaarZonderBtw') : t('bank.lf.klaar'))
        setLijnFactuur(null)
        await runMatch()
      } else if (json?.code === 'paid_invoice_nearby') {
        showToast(t('bank.lf.alBetaald'))
      } else {
        showToast(failureText(res.status, json, t('bank.fout.lijnFactuur')))
      }
    } catch {
      showToast(t('bank.fout.algemeen'))
    } finally {
      setProcessingId(null)
    }
  }

  // [STORNO] One tap: the origin is unlinked (invoice open again), both lines set aside.
  async function applyStorno(stornoTxId: string, originTxId: string) {
    setProcessingId(stornoTxId)
    try {
      const res = await fetch('/api/bank/storno', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stornoTxId, originTxId }) })
      const json = await res.json().catch(() => ({}))
      showToast(res.ok ? t('bank.storno.klaar') : failureText(res.status, json, t('bank.fout.storno')))
      await runMatch()
      await loadIgnored()
    } catch {
      showToast(t('bank.fout.algemeen'))
    } finally {
      setProcessingId(null)
    }
  }
  // [REGEL-WEG] The owner deletes a line no invoice claims. Refused by the server on a linked line.
  async function deleteLine(txId: string) {
    setProcessingId(txId)
    try {
      const res = await fetch('/api/bank/delete-line', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionId: txId }) })
      const json = await res.json().catch(() => ({}))
      if (res.ok) showToast(t('bank.regelWegKlaar'))
      else if (json?.code === 'transaction_linked') showToast(t('bank.fout.regelGekoppeld'))
      else showToast(failureText(res.status, json, t('bank.fout.regelWeg')))
      await runMatch()
      await loadIgnored()
    } catch {
      showToast(t('bank.fout.algemeen'))
    } finally {
      setProcessingId(null)
    }
  }

  async function ignoreTx(txId: string, reason: string | null = null) {
    setProcessingId(txId)
    try {
      const res = await fetch('/api/bank/ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // [BANK-IGNORE-REDEN] Optioneel. Slaat de eigenaar de vraag over, dan gaat er niets mee —
        // de handeling is het negeren, de reden is de aantekening erbij.
        body: JSON.stringify({ transactionId: txId, action: 'ignore', ...(reason ? { reason } : {}) }),
      })
      if (res.ok) {
        showToast(t('bank.transactieGenegeerd'))
        await runMatch()             // drops it from the active list
        await loadIgnored()          // refresh Genegeerd immediately (counter stays correct)
      } else {
        const json = await res.json().catch(() => ({}))
        // [NEGEER-NIET-HALF] Money sits on this line — say which door to take instead.
        showToast(json?.code === 'transaction_partially_linked' ? t('bank.fout.regelGekoppeld') : t('bank.fout.negeren'))
      }
    } catch {
      showToast(t('bank.fout.algemeen'))
    } finally {
      setProcessingId(null)
    }
  }

  // [BANK-IGNORE] Restore: not_found → pending. It returns to the active list.
  async function restoreTx(txId: string) {
    setProcessingId(txId)
    try {
      const res = await fetch('/api/bank/ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: txId, action: 'restore' }),
      })
      if (res.ok) {
        showToast(t('bank.teruggezet'))
        setIgnoredList((prev) => (prev ? prev.filter((s) => s.transactionId !== txId) : prev))
        await runMatch()             // reappears in the active list
      } else {
        showToast(t('bank.fout.terugzetten'))
      }
    } catch {
      showToast(t('bank.fout.algemeen'))
    } finally {
      setProcessingId(null)
    }
  }

  // [BANK-IGNORE] Load ignored list the first time the Genegeerd tab is opened.
  useEffect(() => {
    if (bankTab === 'ignored' && ignoredList === null) {
      void (async () => { await loadIgnored() })()
    }
  }, [bankTab, ignoredList, loadIgnored])

  // [BANK-MULTI-CONFIRM] A transaction stays "pending" in the UI until it is fully
  // covered. Confirming one of several invoices keeps it visible (allCovered=false)
  // with the open numbers still actionable; it only leaves once allCovered=true.
  // [BANK-MULTI-LINK-PERSIST] "Done" is now reload-safe: the match route reports
  // server-side allCovered (survives a reload), and the session `confirmed` state
  // still covers the moment right after a confirm. Either source marking it covered
  // means done.
  const isDone = (s: Suggestion) =>
    s.allCovered === true || confirmed[s.transactionId]?.allCovered === true
  // A partially-linked tx (one invoice paid, others still open) is NOT done — it
  // must stay actionable even when the matcher left it with zero fresh candidates
  // (its only matching invoice is now paid and excluded from candidates).
  const isPartiallyLinked = (s: Suggestion) =>
    !isDone(s) &&
    (s.partiallyLinked === true ||
      (confirmed[s.transactionId] && confirmed[s.transactionId].allCovered === false))
  // [BANK-QUARTER] Quarters present across ALL loaded transactions (pending + done +
  // ignored), newest first, with a per-quarter count for the chip. Filtering is by the BANK
  // date (payment date), so a Q1 invoice paid in Q2 shows under Q2 and the matcher still
  // offers the Q1 invoice — cross-quarter payments land in the quarter the money moved.
  const quarters = quartersPresent([
    ...((data?.suggestions ?? []).map((s) => s.date)),
    ...((ignoredList ?? []).map((s) => s.date)),
  ])
  // [BANK-QUARTER] Default (via 'auto') to the app's shared quarter: the LAST COMPLETED
  // quarter (the one whose BTW is due — what klaar/aangifte/resultaat also default to), so
  // "I'm working on Q2" lands on Q2, not the newest half-open quarter. Fall back to the
  // newest quarter present (or 'all') when the last-completed quarter has no bank data.
  const lc = lastCompletedQuarter()
  const defaultQuarterKey = `${lc.year}-Q${lc.quarter}`
  const autoQuarter = quarters.some((q) => q.key === defaultQuarterKey)
    ? defaultQuarterKey
    : (quarters[0]?.key ?? 'all')
  const effectiveQuarter = quarterSel === 'auto' ? autoQuarter : quarterSel
  const inQ = (s: Suggestion) => matchesQuarter(s.date, effectiveQuarter)

  const pending = (data?.suggestions.filter((s) => !isDone(s)) ?? []).filter(inQ)

  // [BANK-SORT] Stable order by date (newest first) so a restored transaction
  // returns to its logical position instead of jumping to the bottom.
  const byDateDesc = (a: Suggestion, b: Suggestion) =>
    (b.date ?? '').localeCompare(a.date ?? '')

  // [BANK-POS] Card-terminal settlements (ING DD&C / BETAALAUTOMAAT) arrive in
  // bulk every day and never have a supplier invoice. Keeping them in "Geen
  // factuur" buries the real work (actual supplier payments). Detect them and
  // give them their own tab so the owner focuses on invoices that matter.
  // [BANK-POS-ONE-SOURCE] Ask the classifier, not a private three-phrase list. The server knows
  // sixteen acquirers (Mollie, Adyen, Stripe, Worldline, Buckaroo, …) and books their payouts as
  // 'pos_income'; this list knew three. A Mollie settlement was therefore income on the server
  // and sat in the "Geen factuur" tab here, as work the owner could never finish.
  const isPosReceipt = (s: Suggestion) => isPosPayoutDescription(s.description, s.counterpart)

  // [BANK-TABS] Split the (often long) list into purpose-driven groups so the
  // owner isn't drowned in one endless list. Order: the action tab first.
  //   Te bevestigen : auto + choice (a real candidate exists → owner confirms),
  //                   PLUS partially-linked multi-invoice tx (one paid, others open)
  //                   even if the matcher left them with no fresh candidate — they
  //                   still need the owner to link the remaining numbers.
  //   Geen factuur  : none, EXCLUDING POS receipts AND partially-linked tx
  //   Pin           : POS card settlements (bulk, no invoice — normal)
  //   Genegeerd     : owner-ignored (not_found)
  //   Gekoppeld     : confirmed / fully covered
  const toConfirm = pending
    .filter((s) => s.outcome === 'auto' || s.outcome === 'choice' || isPartiallyLinked(s))
    .sort(byDateDesc)
  const noneAll = pending.filter((s) => s.outcome === 'none' && !isPartiallyLinked(s))
  const noMatch = noneAll.filter((s) => !isPosReceipt(s)).sort(byDateDesc)
  const posList = noneAll.filter(isPosReceipt).sort(byDateDesc)
  // [BANK-SAFETY-NET] A DEBIT (money out, amount < 0) with no matching invoice is a payment for
  // which we hold no purchase invoice — a MISSING INKOOPFACTUUR. It matters for the money: no
  // invoice means the voorbelasting (deductible BTW) on that cost is not claimed, so the owner
  // pays more BTW than they should. The bank line is the one signal that survives a silent
  // import miss, so we turn it from a dead-end into a prompt to recover the document.
  // [BANK-PAID-EXPLAINED] Exclude a debit that matches an already-PAID invoice (marked paid by hand
  // in Crediteuren): the invoice exists and its voorbelasting is already claimed, so flagging it as a
  // "missende inkoopfactuur" is a false alarm the owner can never clear.
  const missingPurchaseDebits = noMatch.filter((s) => s.amount < 0 && !s.explainedByPaid && !s.explainedByQueued)
  const confirmedList = (data?.suggestions ?? []).filter((s) => isDone(s)).filter(inQ).sort(byDateDesc)
  // [BANK-QUARTER] Ignored tab, filtered to the selected quarter too.
  const ignoredInQ = (ignoredList ?? []).filter(inQ)
  // [BANK-BATCH-CONFIRM] The subset of "Te bevestigen" that can be bulk-confirmed
  // (strong single-invoice auto matches), and how many of those are currently ticked.
  const batchEligibleList = toConfirm.filter((s) => isBatchEligible(s))
  const batchSelectedCount = batchEligibleList.filter((s) => selectedForBatch.has(s.transactionId)).length

  // [BANK-AUTO-CONFIRM] How many of the shown (quarter-filtered) matches the app would book
  // without a tap. Drives the "handle X automatically" offer; the server stays authoritative on
  // what it actually books.
  // [BANK-IBAN] This copy asked for `reference`, while the server's
  // 'certain' tier is (reference OR iban) + amount and it books an 'amount_only' tier on top.
  // The sibling gate a few hundred lines up was corrected for IBAN and this one was left behind,
  // so a statement whose auto-bookable payments carry no printed invoice number — matched purely
  // on supplier IBAN + exact sum — showed "0 zekere betalingen" and no card at all, while the
  // on-load pass had just booked them. Same predicate as that gate now, from one place, so the
  // two answers cannot drift apart again.
  // [AFHANDELEN-NOEMT] The LIST, not just the count. What this button does is book money against
  // invoices and mark them paid, and until now it said only how many — so the one question an owner
  // has before pressing it ("which ones, and is the wrong one in there?") had no answer on the
  // page. Reported after a card offered an invoice the bank statement never mentioned: the fear was
  // not that the bulk is wrong, it was that there is no way to find out before it runs.
  // ── [NIET-DEZE-FACTUUR] "This is not the invoice for this payment" ────────────────────────────
  //
  // Optimistic and local first: the suggestion disappears the moment it is tapped, because the one
  // thing a refusal must never feel like is a request the app might refuse. Nothing is booked — no
  // link is written, no invoice changes status — so there is no state to roll back if the write
  // fails. What CAN fail is the remembering, and that is said out loud rather than assumed: while
  // bank_match_rejections.sql is not applied the route answers stored:false and the toast says the
  // suggestion will be back after a refresh, instead of a silent lie.
  // What this session removed, kept so it can be put back. A refusal the owner cannot take back is
  // the same trap as a confirm they cannot take back — and the whole complaint that started this
  // was having only one irreversible button on the card.
  const [undoReject, setUndoReject] = useState<Record<string, Candidate>>({})

  const rejectSuggestion = useCallback(async (transactionId: string, invoiceId: string) => {
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        suggestions: prev.suggestions.map((s) => {
          if (s.transactionId !== transactionId) return s
          const gone = (s.candidates ?? []).find((c) => c.invoiceId === invoiceId) ?? s.best
          if (gone) setUndoReject((u) => ({ ...u, [transactionId]: gone }))
          const kept = (s.candidates ?? []).filter((c) => c.invoiceId !== invoiceId)
          const bestGone = s.best?.invoiceId === invoiceId
          // The same rule the server applies (bank-rejections.ts): a refusal REMOVES a suggestion
          // and never promotes one. The runner-up was the runner-up because its evidence was
          // weaker, and answering "no" by pre-selecting the next-best is arguing, not listening.
          return {
            ...s,
            candidates: kept,
            best: bestGone ? null : s.best,
            outcome: kept.length === 0 ? 'none' : bestGone ? 'choice' : s.outcome,
          }
        }),
      }
    })
    // Nothing may stay selected on a card whose selection was just refused.
    setSelected((sel) => (sel[transactionId] === invoiceId ? { ...sel, [transactionId]: '' } : sel))
    try {
      const res = await fetch('/api/bank/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId, invoiceId }),
      })
      const json = (await res.json().catch(() => ({}))) as { stored?: boolean }
      showToast(res.ok && json.stored ? t('bank.nietDeze.weg') : t('bank.nietDeze.nietBewaard'))
    } catch {
      showToast(t('bank.nietDeze.nietBewaard'))
    }
  }, [t, showToast])

  /** [NIET-DEZE-FACTUUR] Put a refused suggestion back. Same shape as the refusal: local first,
   *  then the server, and the sentence tells the truth about whether it was remembered. */
  const undoRejectSuggestion = useCallback(async (transactionId: string) => {
    const cand = undoReject[transactionId]
    if (!cand) return
    setUndoReject((u) => { const next = { ...u }; delete next[transactionId]; return next })
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        suggestions: prev.suggestions.map((s) =>
          s.transactionId === transactionId
            ? { ...s, candidates: [cand, ...(s.candidates ?? [])], outcome: s.outcome === 'none' ? 'choice' : s.outcome }
            : s),
      }
    })
    // Restored as a CHOICE, never back to 'auto'. The owner has now said one thing about this pair
    // and then unsaid it; that is a reason to show it again, not a reason to pre-select it.
    await fetch('/api/bank/reject', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionId, invoiceId: cand.invoiceId }),
    }).catch(() => {})
  }, [undoReject])

  const safeAutoRows = toConfirm.filter((s) => isServerAutoBookable(s))
  const safeAutoCount = safeAutoRows.length

  const tabs = [
    { key: 'confirm' as const, label: t('bank.tab.teBevestigen'), icon: 'fact_check', count: toConfirm.length },
    { key: 'none' as const, label: t('bank.tab.geenFactuur'), icon: 'help', count: noMatch.length },
    { key: 'pin' as const, label: t('bank.tab.pin'), icon: 'point_of_sale', count: posList.length },
    { key: 'ignored' as const, label: t('bank.genegeerd'), icon: 'visibility_off', count: ignoredInQ.length },
    { key: 'done' as const, label: t('bank.tab.bevestigd'), icon: 'link', count: confirmedList.length },
  ]
  // [BANK-WERK-EERST] Is er iets te doen? Alleen dán vouwt de machinerie samen. Bewust de PENDING
  // lijsten en niet 'zijn er transacties': een administratie waarin alles al is afgehandeld heeft
  // geen werk om bovenaan te zetten, en dan is de sleepzone opnieuw het nuttigste ding op het
  // scherm — precies zoals bij een lege administratie.
  const heeftWerk = toConfirm.length + noMatch.length + posList.length > 0
  const setupZichtbaar = setupOpen ?? !heeftWerk

  const activeListRaw =
    bankTab === 'confirm' ? toConfirm
    : bankTab === 'none' ? noMatch
    : bankTab === 'pin' ? posList
    : bankTab === 'ignored' ? ignoredInQ
    : confirmedList

  // searches counterpart / omschrijving / IBAN / reference / date / amount, accent-folded.
  // [SMART-FILTER] tekst + bedrag via de gedeelde, decimaal-bewuste matcher
  // (src/lib/search.ts) — lost de hele-euro-bug op ("670,0" bij € 670,09); de datum
  // blijft een losse ISO-substring. Uitgelicht zodat dezelfde predicate de tab kan
  // kiezen waar een ?find=-hit in zit.
  const matchesFilter = (s: Suggestion, raw: string): boolean =>
    rowMatchesQuery(raw, [s.counterpart, s.description, s.iban, s.reference], [s.amount]) ||
    (s.date ?? '').toLowerCase().includes(raw.toLowerCase())
  const activeList =
    filterText.trim()
      ? activeListRaw.filter((s) => matchesFilter(s, filterText.trim()))
      : activeListRaw

  // [SEARCH-DEEPLINK] A ?find= hit (from the global Cmd+K search) can live in ANY tab, but
  // the page opens on 'confirm'. Without this, seeding the filter would filter the DEFAULT
  // tab — showing an empty list when the line is actually a matched/ignored/none one. Once,
  // after the suggestions load, jump to the first tab that actually contains the hit. One-shot
  // (findJumpedRef) so it never fights the owner's later manual tab clicks or typing.
  const findJumpedRef = useRef(false)
  useEffect(() => {
    if (findJumpedRef.current) return
    const raw = findParam.trim()
    if (!raw || !data) return
    const order: Array<['confirm' | 'none' | 'pin' | 'ignored' | 'done', Suggestion[]]> = [
      ['confirm', toConfirm], ['none', noMatch], ['pin', posList], ['done', confirmedList], ['ignored', ignoredInQ],
    ]
    const here = order.find(([k]) => k === bankTab)
    if (here && here[1].some((s) => matchesFilter(s, raw))) { findJumpedRef.current = true; return }
    const target = order.find(([, list]) => list.some((s) => matchesFilter(s, raw)))
    if (!target) return
    // Defer the tab switch out of the effect body (setState-in-effect) — same setTimeout(0)
    // pattern the ?find= seed effects use. One-shot: mark jumped so it never re-fires.
    findJumpedRef.current = true
    const t = setTimeout(() => setBankTab(target[0]), 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findParam, data, bankTab, toConfirm, noMatch, posList, confirmedList, ignoredInQ])

  // [ENABLEBANKING] De eigenaar komt terug van zijn bank. De callback-route zet het resultaat in de
  // query string en stuurt hem hierheen; hier wordt het één zin op het scherm.
  //
  // De EERSTE ophaalronde start hier, niet in de callback: die callback is een redirect waar de
  // eigenaar op staat te wachten, en een eerste sync kan een jaar historie over meerdere
  // rekeningen zijn. Doe je dat daar, dan kijkt hij na een geslaagde toestemming tegen een
  // time-out van zijn browser aan. Hier draait het terwijl de pagina er al staat.
  const bankConnectHandledRef = useRef(false)
  // [BANK-WERK-EERST] Het bestandsveld krijgt een ref, zodat "Afschrift toevoegen" in de
  // ingeklapte kop precies hetzelfde doet als de sleepzone eronder — één tik, geen omweg.
  const statementFileRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const outcome = searchParams.get('bank')
    if (!outcome || bankConnectHandledRef.current) return
    bankConnectHandledRef.current = true

    if (outcome === 'fout') {
      showToast(searchParams.get('reden') ?? t('bkc.koppelenMislukt'))
      return
    }
    if (outcome !== 'gekoppeld') return

    const accounts = Number(searchParams.get('rekeningen') ?? '0')
    showToast(
      accounts === 1
        ? t('bank.bankGekoppeld')
        : t('bank.bankGekoppeldMeer', { count: accounts }),
    )
    void (async () => {
      try {
        const res = await fetch('/api/bank/enablebanking/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const json = await res.json()
        if (!res.ok) { showToast(failureText(res.status, json, t('bank.fout.ophalen'))); return }
        const inserted = Number(json.inserted ?? 0)
        const unread = Array.isArray(json.warnings) ? json.warnings.length : 0
        // Nooit stil een transactie kwijtraken — dezelfde regel als bij een upload.
        showToast(
          unread > 0
            ? (unread === 1
                ? t('bank.opgehaaldOnleesbaarEen', { inserted })
                : t('bank.opgehaaldOnleesbaar', { inserted, count: unread }))
            : inserted > 0
              ? t('bank.opgehaaldAantal', { count: inserted })
              : t('bank.geenTransactiesBank'),
        )
        if (inserted > 0) { await runMatch(); await loadStatements() }
      } catch {
        showToast(t('bank.fout.ophalen'))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  return (
    <div style={{ maxWidth: COLUMN.work, margin: '0 auto', padding: '16px 14px 96px', fontFamily: FONT, color: M3.onSurface }}>
      {/* [MOVE-PAYMENT] Which invoice does this payment belong to?
          No free search field: the server returns only invoices that can actually receive the
          money (same direction, payable status, enough still open, not locked by the accountant),
          in the order they are likely meant — same supplier first, then an exactly fitting amount,
          then the nearest date. Each row shows what is still open, so choosing is informed rather
          than a guess with a confirmation after it. */}
      {moveCtx && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 340, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setMoveCtx(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: `${R.lg}px ${R.lg}px 0 0`, padding: 24, paddingBottom: sheetPaddingBottom(24), width: '100%', maxWidth: 520, maxHeight: '80vh', overflowY: 'auto', fontFamily: FONT }}
          >
            <h3 style={{ fontSize: 17, fontWeight: 700, color: M3.onSurface, margin: '0 0 6px' }}>
              {t('bank.betalingVerplaatsen')}
            </h3>
            <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.5, margin: '0 0 18px' }}>
              {moveCtx.source.invoice_number
                ? (moveCtx.source.client_name
                    ? t('bank.verplaats.opFactuurVan', { number: moveCtx.source.invoice_number, name: moveCtx.source.client_name })
                    : t('bank.verplaats.opFactuur', { number: moveCtx.source.invoice_number }))
                : (moveCtx.source.client_name
                    ? t('bank.verplaats.opEenFactuurVan', { name: moveCtx.source.client_name })
                    : t('bank.verplaats.opEenFactuur'))}{' '}
              {t('bank.verplaats.kies')}
            </p>

            {moveCtx.payments.map(pm => (
              <div key={pm.id} style={{ marginBottom: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: M3.onSurface, marginBottom: 8 }}>
                  {eur.format(pm.amount_applied)}
                  {pm.method === 'kas' ? ` · ${t('lijst.contant')}` : pm.transaction_id ? ` · ${t('lijst.bank')}` : ''}
                </div>
                {!pm.movable ? (
                  <p style={{ fontSize: 13, color: '#9a5b00', background: '#fff4e5', border: '1px solid #ffd9a8', borderRadius: R.sm, padding: '10px 12px', margin: 0, lineHeight: 1.5 }}>
                    {t('bank.verplaats.geenBedrag')}
                  </p>
                ) : pm.targets.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#5F6368', background: '#F8F9FA', borderRadius: R.sm, padding: '10px 12px', margin: 0, lineHeight: 1.5 }}>
                    {t('ink.geenPassendeFactuur', { amount: eur.format(pm.amount_applied) })}
                  </p>
                ) : (
                  pm.targets.map(tgt => {
                    // [OPEN-TOTAL] De zesde plek die openstaand zelf uitrekende. Dezelfde som,
                    // maar openAmount rondt op centen af én laat de status beslissen — en dat
                    // laatste is waarom deze regel de gedeelde functie moet gebruiken en niet
                    // openBalanceFromAmounts: MoveTarget draagt vandaag geen status, dus beide
                    // geven nu hetzelfde getal. Krijgt hij er ooit één, dan klopt deze regel
                    // vanzelf mee, terwijl de losse som stil verkeerd zou blijven.
                    const open = openAmount(tgt)
                    return (
                      <button
                        key={tgt.id}
                        onClick={() => doMove(pm.id, tgt)}
                        style={{ width: '100%', textAlign: 'start', marginBottom: 8, padding: '12px 14px', borderRadius: R.sm, border: `1px solid ${M3.surfaceVariant}`, background: '#fff', cursor: 'pointer', fontFamily: FONT, display: 'block' }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 600, color: M3.onSurface }}>
                          {tgt.invoice_number || t('bank.geenNummer')} · {tgt.client_name || '—'}
                        </div>
                        <div style={{ fontSize: 12.5, color: '#5F6368', marginTop: 2 }}>
                          {eur.format(Math.abs(Number(tgt.total_inc_btw ?? 0)))} · {t('bank.nogOpenBedrag', { amount: eur.format(open) })}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
            ))}

            <button
              onClick={() => setMoveCtx(null)}
              style={{ width: '100%', padding: '14px', borderRadius: R.full, background: 'transparent', color: '#1A73E8', fontSize: 15, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}
            >
              {t('lijst.annuleren')}
            </button>
          </div>
        </div>
      )}
      {/* [HEADER-SYSTEM] Title "Bank" + back live in the shared sub-page bar
          (DashboardChrome/STATIC_TITLES); the in-body h1 that repeated it was
          removed. The descriptive intro line stays. */}
      {/* ── [BANK-STAND] Wat er nú op je wacht ────────────────────────────────────────────────
          Hier stond een vaste beschrijving van wat dit scherm dóét ("Koppel je bank of upload je
          bankafschrift…"). Die las elke dag hetzelfde, hoeveel of hoe weinig er ook lag — terwijl
          de ondernemer die zin al kent na de eerste keer, en de vraag waarmee hij komt een andere
          is: moet ik hier iets?
          Dezelfde plaats en dezelfde toon als de kopregel van /dashboard/incoming, die deze vorm al
          had. En het is geen extra blok: het vervangt de regel die er stond.
          Zolang de eerste lezing loopt (data === null) staat er niets. "Alles afgehandeld" boven een
          scherm dat nog aan het laden is, is precies het soort geruststelling dat later een leugen
          blijkt te zijn geweest. */}
      {/* [BLIND-GEMATCHT] Two signals this page can lose with nothing to show for it: the memory of
          what the owner already confirmed, and the list of suggestions they refused. Losing the
          first makes a counterparty they identify every month go manual again; losing the second
          brings back a suggestion they explicitly said no to. Both make the app look like it
          forgot — and an app that seems to forget is one nobody teaches twice. So it says which
          one it could not read, once, above the list it affects. */}
      {data?.degraded && (
        <p style={{ fontSize: 13, color: '#B26A00', margin: '0 0 12px', lineHeight: 1.5, textAlign: 'start' }}>
          {/* [RUSTIG] Two losses, two sentences — and when both happened, both are shown rather
              than a third sentence that says the same thing twice. One thought, one place. */}
          {data.degraded.memory && t('bank.blind.geheugen')}
          {data.degraded.memory && data.degraded.refusals && ' '}
          {data.degraded.refusals && t('bank.blind.geweigerd')}
          {/* [BLIND-LEVERANCIER] The third loss in the same family: the account each supplier is
              known to bill from. Without it a payment carrying only an IBAN has nothing to be
              recognised by, and goes back to the manual pile as if it never could be. */}
          {(data.degraded.memory || data.degraded.refusals) && data.degraded.supplierIbans && ' '}
          {data.degraded.supplierIbans && t('bank.blind.leverancier')}
        </p>
      )}

      {data && (
        <p style={{ fontSize: 13.5, color: '#5F6368', margin: '0 0 18px', lineHeight: 1.5 }}>
          {/* "Nog geen transacties" hangt aan de lezing zelf, niet aan de genegeerd-lijst: die
              wordt pas geladen als dat tabblad wordt geopend, dus bij de eerste verf is hij altijd
              leeg — en een administratie met alleen genegeerde regels zou dan lezen als een lege. */}
          {(data.suggestions?.length ?? 0) === 0
            ? t('bank.stand.leeg')
            : !heeftWerk
              ? t('bank.stand.klaar')
              : (
                <>
                  {toConfirm.length > 0 && (
                    <strong style={{ color: '#3c4043' }}>
                      {toConfirm.length === 1
                        ? t('bank.stand.bevestigenEen')
                        : t('bank.stand.bevestigen', { count: toConfirm.length })}
                    </strong>
                  )}
                  {toConfirm.length > 0 && noMatch.length > 0 && ' '}
                  {noMatch.length > 0 && (
                    noMatch.length === 1
                      ? t('bank.stand.geenFactuurEen')
                      : t('bank.stand.geenFactuur', { count: noMatch.length })
                  )}
                  {/* De pinregels horen erbij, anders is de zin LEEG op een scherm waar alleen
                      pinafrekeningen wachten — heeftWerk telt ze mee, dus zonder deze zin zou daar
                      een lege alinea staan boven een lijst met werk. */}
                  {(toConfirm.length > 0 || noMatch.length > 0) && posList.length > 0 && ' '}
                  {posList.length > 0 && (
                    posList.length === 1
                      ? t('bank.stand.pinEen')
                      : t('bank.stand.pin', { count: posList.length })
                  )}
                </>
              )}
        </p>
      )}

      {/* ── [BANK-WERK-EERST] De kop van de machinerie ──────────────────────────────────────
          Eén regel in plaats van drie blokken, met de handeling die de ondernemer hier écht doet
          (een afschrift toevoegen) als knop erin. Alleen zichtbaar als er werk is — anders staat
          alles gewoon open en is deze regel er niet, want dan is de sleepzone het scherm. */}
      {heeftWerk && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          padding: '10px 14px', marginBottom: setupZichtbaar ? 14 : 18,
          borderRadius: R.lg, background: M3.surface, boxShadow: EL1, border: '1px solid #EEE',
        }}>
          <button
            type="button"
            onClick={() => setSetupOpen(!setupZichtbaar)}
            aria-expanded={setupZichtbaar}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none',
              padding: 0, cursor: 'pointer', fontFamily: FONT, minWidth: 0, textAlign: 'start',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#5F6368' }} aria-hidden>
              {setupZichtbaar ? 'expand_less' : 'expand_more'}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#3c4043' }}>
              {t('bank.setup.kop')}
            </span>
            {statements && statements.length > 0 && (
              <span style={{ fontSize: 12.5, color: '#5F6368' }}>
                {statements.length === 1
                  ? t('bank.setup.aantalEen')
                  : t('bank.setup.aantal', { count: statements.length })}
              </span>
            )}
          </button>
          {/* Uploaden blijft één tik, ook ingeklapt: dezelfde input als de sleepzone hieronder. */}
          <button
            type="button"
            disabled={busy}
            onClick={() => statementFileRef.current?.click()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
              padding: '7px 14px', borderRadius: R.full, border: `1px solid ${M3.primary}`,
              background: '#fff', color: M3.primary, fontSize: 12.5, fontWeight: 600,
              cursor: busy ? 'default' : 'pointer', fontFamily: FONT, opacity: busy ? 0.6 : 1,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>
              {busy ? 'hourglass_empty' : 'upload_file'}
            </span>
            {busy ? t('bank.bezig') : t('bank.setup.toevoegen')}
          </button>
        </div>
      )}

      {/* [WACHTKOPPELING] Betalingen die de eigenaar al deed en die de bank nog niet liet zien.
          Hier, omdat dit het scherm is waar je kijkt of geld al binnen is — en omdat een voorstel,
          als er een komt, over een regel op dit scherm gaat. */}
      <WachtkoppelingPanel onChanged={() => { void runMatch() }} />

      {/* [ENABLEBANKING] De bankkoppeling. Verbergt zichzelf als de server er niet voor is ingesteld. */}
      {setupZichtbaar && (
        <BankConnectPanel
          onMessage={showToast}
          onImported={() => { void runMatch(); void loadStatements() }}
        />
      )}

      {/* [BANK-WERK-EERST] Het bestandsveld staat ALTIJD in de pagina, ook ingeklapt — de knop in
          de kop hierboven klikt erop. `htmlFor` houdt de sleepzone hieronder een echt <label>, dus
          slepen en klikken blijven allebei werken op precies dezelfde invoer. */}
      <input
        ref={statementFileRef}
        id="bank-statement-file"
        type="file"
        accept=".xml,.940,.sta,.mt940,.txt"
        onChange={handleFile}
        disabled={busy}
        style={{ display: 'none' }}
      />

      {/* [P1-UNCATEGORIZED] Money that is NOT yet in your books. A bank line without a category
          is silently excluded from the W&V/BTW — so make it loud, not invisible. Links straight
          to the categorisation screen where these get an identity (kost, huur, fee, transfer…). */}
      {uncatCount > 0 && (
        <Link
          href="/dashboard/bank/categoriseren"
          style={{
            display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none',
            background: '#FEF7E0', border: '1px solid #FBBC04', borderRadius: R.md,
            padding: '12px 14px', marginBottom: 16,
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 22, color: '#B06000' }} aria-hidden>label_important</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: '#7A4F00' }}>
              {uncatCount === 1 ? t('bank.uncatEen') : t('bank.uncat', { count: uncatCount })}
            </span>
            {/* [BANK-GELD-NIET-GEBOEKT] Het BEDRAG, tussen het aantal en de uitleg. "299
                banktransacties" is een klus; "€ 266.834 aan uitgaven" is zijn geld — en dat is wat
                er werkelijk buiten zijn winst & verlies staat. Uit en in blijven apart: netto zou
                € 10.000 in en € 10.000 uit lezen als "er mist niets", terwijl het twee onverklaarde
                feiten zijn (zie financial-result.ts). Kon de server niet optellen, dan staat hier
                niets — een te laag bedrag is erger dan geen bedrag. */}
            {(uncatOut ?? 0) + (uncatIn ?? 0) > 0 && (
              <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#7A4F00', marginTop: 2 }}>
                {(uncatOut ?? 0) > 0 && (uncatIn ?? 0) > 0
                  ? t('bank.uncatGeld.beide', { uit: eur.format(uncatOut as number), in: eur.format(uncatIn as number) })
                  : (uncatOut ?? 0) > 0
                    ? t('bank.uncatGeld.uit', { uit: eur.format(uncatOut as number) })
                    : t('bank.uncatGeld.in', { in: eur.format(uncatIn as number) })}
              </span>
            )}
            <span style={{ display: 'block', fontSize: 12, color: '#7A4F00', marginTop: 1 }}>
              {t('bank.uncatUitleg')}
            </span>
          </span>
        </Link>
      )}

      {/* Upload card */}
      {setupZichtbaar && (
      <label
        htmlFor="bank-statement-file"
        onDrop={onDropZone}
        onDragOver={onDragOverZone}
        onDragLeave={onDragLeaveZone}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8, padding: '28px 16px', borderRadius: R.lg, cursor: busy ? 'default' : 'pointer',
          // [BANK-DND] Thicken + fill the border while a file is dragged over.
          border: `${dragActive ? 2.5 : 1.5}px dashed ${M3.primary}`,
          background: dragActive ? '#BBD4FB' : M3.primaryContainer,
          textAlign: 'center',
          opacity: busy ? 0.7 : 1, transition: 'all 0.15s',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 32, color: M3.primary }} aria-hidden>
          {busy ? 'hourglass_empty' : 'upload_file'}
        </span>
        <span style={{ fontSize: 14.5, fontWeight: 600, color: M3.onPrimaryContainer }}>
          {busy ? t('bank.bezig') : dragActive ? t('bank.laatLos') : t('bank.kiesAfschrift')}
        </span>
        <span style={{ fontSize: 12, color: '#41618a' }}>{t('bank.formaten')}</span>
        {/* [BANK-DND] Tell the owner drag-and-drop is available. */}
        {!busy && !dragActive && (
          <span style={{ fontSize: 11.5, color: '#5b7aa8' }}>{t('bank.upload.sleep')}</span>
        )}
      </label>
      )}

      {/* Upload summary */}
      {uploadInfo && (
        <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: R.md, background: M3.surface, boxShadow: EL1, fontSize: 13, color: '#3c4043' }}>
          {/* [MELDING-WEG] A report that has been read can be taken off the screen — the same X every
              finished notice in the app carries. It had no exit at all: the card stayed until the
              page was left. The warnings below go with it; this card is the upload's report, and the
              owner decides when they are done reading it. */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{uploadInfo.format}</strong> · {t('bank.upload.gelezen', { parsed: uploadInfo.parsed, inserted: uploadInfo.inserted })}
              {uploadInfo.skipped > 0 ? ` · ${t('bank.upload.dubbel', { count: uploadInfo.skipped })}` : ''}
            </div>
            <DismissX label={t('melding.weghalen')} onClick={() => setUploadInfo(null)} style={{ width: 32, height: 32, marginTop: -6 }} />
          </div>
          {/* [R2] Never silently short a transaction: if lines couldn't be read, say so —
              they're in the stored file for the accountant, but not in this overview. */}
          {uploadInfo.unreadable > 0 && (
            <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: R.sm, background: '#FEE8C4', color: '#7C5800', fontSize: 12.5, fontWeight: 600 }}>
              ⚠ {uploadInfo.unreadable === 1 ? t('bank.upload.onleesbaarEen') : t('bank.upload.onleesbaar', { count: uploadInfo.unreadable })}
            </div>
          )}
          {/* [BANK-BALANCE §2.6] The statement doesn't tie out to its own begin/eindsaldo → a bank
              line is missing. A stronger (red) banner than the unreadable-line notice: this means
              the figures are incomplete until the full afschrift is re-uploaded. */}
          {uploadInfo.balanceWarning && (
            <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: R.sm, background: '#FCE8E6', color: '#B3261E', fontSize: 12.5, fontWeight: 600 }}>
              ⚠ {uploadInfo.balanceWarning}
            </div>
          )}
          {/* [BANK-BALANCE] En het omgekeerde, dat tot nu toe werd berekend en weggegooid.
              De app bewees bij élke upload dat beginsaldo + alle mutaties precies op het
              eindsaldo uitkomt — en zei het alleen als het NIET klopte. Zwijgen bij succes maakt
              van het sterkste dat dit product kan zeggen ("je afschrift sluit, tot op de cent")
              een non-gebeurtenis, en van de rode melding een schrikbericht zonder tegenhanger.
              Een controle die je alleen hoort als hij faalt, voelt als een storing; een controle
              die je ook hoort als hij slaagt, is een bewijs. */}
          {!uploadInfo.balanceWarning && uploadInfo.balanceReconciliation?.checkable && uploadInfo.balanceReconciliation.ok && (
            <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: R.sm, background: '#E6F4EA', color: '#1E6C33', fontSize: 12.5, fontWeight: 600, lineHeight: 1.45 }}>
              ✓ {t('bank.saldoSluit', { opening: eur.format(uploadInfo.balanceReconciliation.opening ?? 0), count: uploadInfo.balanceReconciliation.txCount, closing: eur.format(uploadInfo.balanceReconciliation.closing ?? 0) })}
            </div>
          )}
          {/* [STATEMENT-CONTINUITY] Het gat TUSSEN twee afschriften: een ontbrekende periode of
              een saldobreuk. Onzichtbaar in de bestanden zelf (die kloppen allebei), dus dit is
              de enige plek waar het gezegd kan worden — en het moment waarop de eigenaar het
              ontbrekende bestand met één handeling bij zijn bank kan ophalen. */}
          {uploadInfo.continuityWarning && (
            <div style={{ marginTop: 8, padding: '10px 12px', borderRadius: R.sm, background: '#FEF7E0', color: '#B06000', fontSize: 12.5, fontWeight: 600, lineHeight: 1.45 }}>
              ⚠ {uploadInfo.continuityWarning}
            </div>
          )}
        </div>
      )}

      {/* [BANK-STATEMENTS] Uploaded statements table — shows what the owner has
          uploaded and when. Plus a "refresh names" action that upgrades older
          rows whose name is still "Onbekende" (read from their description). */}
      {setupZichtbaar && statements && statements.length > 0 && (
        <div style={{ marginTop: 16, borderRadius: R.lg, background: M3.surface, boxShadow: EL1, border: '1px solid #EEE', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', borderBottom: '1px solid #F0F0F0' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#3c4043', letterSpacing: 0.3 }}>
              {t('bank.afschriften')}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {/* [BANK-REMATCH] Sits beside "Namen bijwerken" because it is the same kind of
                  action: something the owner runs ONCE, over everything, when they suspect the
                  app is holding an old answer. The pending list re-matches itself on every load,
                  so the real work here is the set-aside lines — those are never looked at again
                  otherwise, and an invoice that arrives weeks later can never reach them. */}
              <button
                onClick={forceRematch}
                disabled={rematching}
                title={t('bank.rematch.titel')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${M3.surfaceVariant}`,
                  background: '#fff', borderRadius: R.full, padding: '5px 11px', cursor: rematching ? 'default' : 'pointer',
                  fontFamily: FONT, fontSize: 12, fontWeight: 600, color: M3.primary, opacity: rematching ? 0.6 : 1,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden>
                  {rematching ? 'hourglass_empty' : 'restart_alt'}
                </span>
                {rematching ? t('bank.bezig') : t('bank.opnieuwMatchen')}
              </button>
              <button
                onClick={refreshNames}
                disabled={refreshingNames}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, border: `1px solid ${M3.surfaceVariant}`,
                  background: '#fff', borderRadius: R.full, padding: '5px 11px', cursor: refreshingNames ? 'default' : 'pointer',
                  fontFamily: FONT, fontSize: 12, fontWeight: 600, color: M3.primary, opacity: refreshingNames ? 0.6 : 1,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden>
                  {refreshingNames ? 'hourglass_empty' : 'refresh'}
                </span>
                {refreshingNames ? t('bank.bezig') : t('bank.namenBijwerken')}
              </button>
            </div>
          </div>
          {/* [BANK-REMATCH] The result stays readable after the toast is gone. The case that
              needs it most is "gevonden, maar niet aangeraakt": the pass deliberately does not
              revive a line on an ambiguous match — that is the nagging the owner used "Genegeerd"
              to escape — so it has to say where to look instead of quietly doing nothing. */}
          {rematchInfo && (
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #F0F0F0', background: '#F8F9FA', fontSize: 12.5, color: '#3c4043', lineHeight: 1.5 }}>
              {/* [BLIND-LEVERANCIER] "Niets nieuws te koppelen" is a claim about the administratie.
                  When a matching signal could not be read it is a claim about a database, and the
                  owner must be able to tell the two apart before they conclude there is nothing
                  there. Said beside the count, never instead of it. */}
              {rematchInfo.supplierIbansUnavailable && (
                <div style={{ color: '#B26A00', marginBottom: 4 }}>{t('bank.blind.leverancier')}</div>
              )}
              {rematchInfo.restored === 0 && rematchInfo.booked === 0 && rematchInfo.ambiguous === 0 ? (
                <>{t('bank.rematch.alles', { count: rematchInfo.examined })}</>
              ) : (
                <>
                  {rematchInfo.restored > 0 && <><strong>{rematchInfo.restored}</strong> {rematchInfo.restored === 1 ? t('bank.rematch.hersteldEen') : t('bank.rematch.hersteld')} </>}
                  {rematchInfo.booked > 0 && <><strong>{rematchInfo.booked}</strong> {rematchInfo.booked === 1 ? t('bank.rematch.geboektEen') : t('bank.rematch.geboekt')} </>}
                  {rematchInfo.ambiguous > 0 && (
                    <>{rematchInfo.ambiguous === 1 ? t('bank.rematch.ambiguEen') : t('bank.rematch.ambigu', { count: rematchInfo.ambiguous })}</>
                  )}
                </>
              )}
            </div>
          )}
          {statements.map((st) => (
            <div key={st.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 14px', borderBottom: '1px solid #f8f9fa' }}>
              <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#9aa0a6', flexShrink: 0 }} aria-hidden>description</span>
                <span style={{ fontSize: 13, color: '#3c4043', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {st.name}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 11.5, color: '#70757a', whiteSpace: 'nowrap' }}>
                  {fmtUploadDate(st.uploadedAt)}
                </span>
                {/* [BANK-STATEMENT-DELETE] Delete this statement (replace a wrong
                    upload). Opens a confirm dialog — never deletes on first click. */}
                <button
                  onClick={() => setStatementToDelete({ id: st.id, name: st.name })}
                  disabled={deletingStatementId === st.id}
                  aria-label={t('bank.afschrift.verwijderen')}
                  title={t('lijst.verwijderen')}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 30, height: 30, borderRadius: R.full, border: 'none', background: 'transparent',
                    cursor: deletingStatementId === st.id ? 'default' : 'pointer', color: M3.error,
                    opacity: deletingStatementId === st.id ? 0.5 : 1,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>
                    {deletingStatementId === st.id ? 'hourglass_empty' : 'delete'}
                  </span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* [BANK-AUTO-CONFIRM] "Quiet by default": the app offers to book the near-certain
          payments itself, so the owner isn't tapping through hundreds of sure matches. The
          server only books reference+exact-amount single-invoice matches, and every
          booking is reversible — the ambiguous ones stay in the list for the human. */}
      {safeAutoCount > 0 && (
        <div style={{ marginTop: 18, borderRadius: R.lg, background: M3.primaryContainer, padding: '16px 18px', boxShadow: EL1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 22, color: M3.primary }} aria-hidden>bolt</span>
            <div style={{ fontSize: 15, fontWeight: 700, color: M3.onPrimaryContainer }}>
              {autoRunning
                ? (safeAutoCount === 1 ? t('bank.auto.bezigEen') : t('bank.auto.bezig', { count: safeAutoCount }))
                : (safeAutoCount === 1 ? t('bank.auto.klaarEen') : t('bank.auto.klaar', { count: safeAutoCount }))}
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: '#3c4043', margin: '6px 0 10px', lineHeight: 1.5 }}>
            {t('bank.auto.uitleg')}
          </div>
          {/* [AFHANDELEN-NOEMT] Exactly what will be booked, before it is. One row per payment:
              the date and counterparty as the bank wrote them, the amount, and the invoice it will
              be marked against. An owner who recognises a wrong pair here can stop — and one who
              recognises nothing wrong has actually checked, instead of trusting a number. */}
          {!autoRunning && (
            <ul style={{
              listStyle: 'none', margin: '0 0 12px', padding: 0,
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              {safeAutoRows.map((s) => (
                <li key={s.transactionId} style={{
                  background: '#fff', borderRadius: R.md, padding: '7px 10px',
                  fontSize: 12, color: '#3c4043', lineHeight: 1.45, textAlign: 'start',
                  display: 'flex', flexWrap: 'wrap', gap: '2px 8px', alignItems: 'baseline',
                }}>
                  <span style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.counterpart || t('verd.onbekendeTegenpartij')}
                  </span>
                  <span style={{ color: '#5F6368' }}>{s.date}</span>
                  <span style={{ fontFamily: FONT_NUM, fontWeight: 600, marginInlineStart: 'auto' }}>
                    {eur.format(Math.abs(s.amount))}
                  </span>
                  <span style={{ flexBasis: '100%', color: '#5F6368' }}>
                    {t('bank.auto.wordtGeboektOp', { nummer: s.best?.invoiceNumber ?? '—' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {/* [BANK-AUTO-RUN] The app already books these on load; this button is only a manual
              re-trigger if the automatic pass was interrupted (e.g. a network hiccup). */}
          <button
            onClick={autoConfirm}
            disabled={autoRunning}
            style={{
              padding: '11px 16px', borderRadius: R.full, border: 'none',
              background: autoRunning ? '#dadce0' : M3.primary, color: '#fff',
              fontSize: 14, fontWeight: 600, fontFamily: FONT, cursor: autoRunning ? 'default' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>{autoRunning ? 'hourglass_empty' : 'auto_awesome'}</span>
            {autoRunning ? t('bank.bezig') : t('bank.nuAfhandelen')}
          </button>
        </div>
      )}
      {/* [AFHANDELEN-STIL] Reported: "Nu afhandelen" doet zichtbaar niets.
          
          This block used to require THREE things at once — the server booked something, AND the
          screen's own counter had already fallen to zero. Both fail in the case that was reported:
          the server books nothing, the counter stays at 1, and the panel above keeps saying
          "1 zekere betaling klaar om af te handelen". Nothing on the page changes, so the owner
          taps again, and again.
          
          The server may refuse what this screen calls certain, and legitimately: it knows about an
          invoice the accountant has locked, a quarter already filed, a payment booked elsewhere in
          the meantime. This screen cannot know which — so it reports what it DOES know, which is
          that nothing was booked, and points at the thing that still works. A partial run is now
          reported too: booking 1 of 2 used to be as silent as booking none. */}
      {autoDoneCount != null && (
        <div style={{
          marginTop: 18, borderRadius: R.lg, padding: '14px 16px',
          background: autoDoneCount > 0 ? M3.successContainer : M3.surfaceVariant,
        }}>
          <div style={{
            fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
            color: autoDoneCount > 0 ? M3.success : '#3c4043',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>
              {autoDoneCount > 0 ? 'task_alt' : 'info'}
            </span>
            {autoDoneCount === 0
              ? t('bank.auto.geenGeboekt')
              : autoDoneCount === 1 ? t('bank.auto.gedaanEen') : t('bank.auto.gedaan', { count: autoDoneCount })}
          </div>
          {autoDoneCount > 0 && safeAutoCount === 0 && (
            <div style={{ fontSize: 12.5, color: '#0B5345', marginTop: 2 }}>{t('bank.rustig')}</div>
          )}
        </div>
      )}

      {/* [KAS-ACHTER-BANK] En wat de app met opzet niet heeft geboekt.
          
          Twee standen, en ze verschillen wezenlijk. `filed_quarter` is de app die het goed doet:
          het kwartaal is aangegeven, dus een gok op bedrag + naam zou een fout naar de
          Belastingdienst schrijven in plaats van in de administratie. `unknown_filing` is de app
          die het NIET WEET — de btw_filings-lezing faalde — en dat is de gevaarlijke stand, want
          "niets geboekt" ziet er dan precies zo uit als een rustige dag. [NO-SILENT-EMPTY]
          
          Onder de teller, niet ernaast: "0 geboekt" en "3 met opzet overgeslagen" is samen één
          verhaal, en dit is de tweede helft ervan. */}
      {kasRefusals && ((kasRefusals.filed_quarter ?? 0) > 0 || (kasRefusals.unknown_filing ?? 0) > 0) && (
        <div style={{
          marginTop: 10, borderRadius: R.lg, padding: '13px 16px',
          background: (kasRefusals.unknown_filing ?? 0) > 0 ? '#FEF7E0' : M3.surfaceVariant,
          border: `1px solid ${(kasRefusals.unknown_filing ?? 0) > 0 ? '#F9E3A2' : M3.outlineVariant}`,
        }}>
          {(kasRefusals.filed_quarter ?? 0) > 0 && (
            <div style={{ fontSize: 13, color: '#3c4043', lineHeight: 1.5 }}>
              {t('bank.kas.aangegeven', { count: kasRefusals.filed_quarter ?? 0 })}
            </div>
          )}
          {(kasRefusals.unknown_filing ?? 0) > 0 && (
            <div style={{ fontSize: 13, color: '#6B5200', lineHeight: 1.5, marginTop: (kasRefusals.filed_quarter ?? 0) > 0 ? 6 : 0 }}>
              {t('bank.kas.onbekend', { count: kasRefusals.unknown_filing ?? 0 })}
            </div>
          )}
        </div>
      )}

      {/* [BANK-TABS] Tabs — only once we have data with at least one transaction */}
      {data && (toConfirm.length + noMatch.length + posList.length + confirmedList.length + (ignoredList?.length ?? 0)) > 0 && (
        <>
          {/* [BANK-QUARTER] Quarter filter — only when more than one quarter is loaded.
              Defaults (via 'auto') to the newest quarter so the owner sees just the
              quarter they're working on; "Alle" brings every quarter back. Counts are
              per quarter so it's obvious no data was deleted — only filtered. */}
          {quarters.length >= 2 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18, alignItems: 'center' }}>
              <span style={{ fontSize: 12.5, color: '#5F6368', fontWeight: 700 }}>{t('bank.kwartaal')}</span>
              {([{ key: 'all', label: t('bank.alle'), count: null as number | null }, ...quarters.map((q) => ({ key: q.key, label: quarterLabelOf(q.key), count: q.count }))]).map((q) => {
                const active = q.key === 'all' ? quarterSel === 'all' : effectiveQuarter === q.key
                return (
                  <button
                    key={q.key}
                    onClick={() => setQuarterSel(q.key)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px',
                      borderRadius: R.full, cursor: 'pointer', fontFamily: FONT, fontSize: 12.5, fontWeight: 600,
                      border: `1px solid ${active ? M3.primary : '#E0E0E0'}`,
                      background: active ? M3.primaryContainer : '#fff',
                      color: active ? M3.onPrimaryContainer : '#5F6368',
                    }}
                  >
                    {q.label}
                    {q.count != null && <span style={{ opacity: 0.6, fontFamily: FONT_NUM }}>{q.count}</span>}
                  </button>
                )
              })}
            </div>
          )}
          {/* [BANK-CHIPS] Chips grid instead of a horizontal scroll bar: every tab
              is visible at once and wraps to the next line on narrow screens — no
              hidden horizontal scroll the owner can miss. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {/* [BANK-LEGE-TAB] Een tabblad met niets erin wordt niet getoond.
                Er stonden er vijf, altijd, met een teller erbij — en bij een gewone administratie
                zijn er twee of drie leeg. Die leiden naar een lijst met niets, dus ze vragen wel
                aandacht en beantwoorden niets: de ondernemer leest vijf getallen om te ontdekken
                welke twee ertoe doen.
                Het ACTIEVE tabblad blijft altijd staan, ook als het leegloopt. Anders verdwijnt het
                onder zijn vinger op het moment dat hij zijn laatste regel afhandelt — en juist dan
                hoort er "je bent hier klaar" te staan, niet een sprong naar een ander tabblad. */}
            {tabs.filter((t) => t.count > 0 || t.key === bankTab).map((t) => {
              const active = bankTab === t.key
              return (
                <button
                  key={t.key}
                  onClick={() => setBankTab(t.key)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px',
                    borderRadius: R.full, cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 600,
                    border: `1px solid ${active ? M3.primary : '#E0E0E0'}`,
                    background: active ? M3.primaryContainer : '#fff',
                    color: active ? M3.onPrimaryContainer : '#5F6368',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>{t.icon}</span>
                  {t.label}
                  <span style={{
                    fontSize: 11, fontWeight: 700, padding: '0px 6px', borderRadius: R.full, fontFamily: FONT_NUM,
                    background: active ? '#fff' : M3.surfaceVariant, color: active ? M3.primary : '#5F6368',
                  }}>
                    {t.count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* [BANK-SAFETY-NET] Missing purchase invoices — a debit we can't match to any
              invoice means the deductible BTW on that cost isn't claimed. The bank line is the
              backstop that catches whatever import missed; turn it into a recovery prompt. */}
          {bankTab === 'none' && missingPurchaseDebits.length > 0 && (
            <div style={{ marginTop: 12, borderRadius: R.lg, background: '#FFF3E0', padding: '14px 16px', boxShadow: EL1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#B26A00' }} aria-hidden>receipt_long</span>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#7A4B00' }}>
                  {missingPurchaseDebits.length === 1 ? t('bank.zonderInkoopEen') : t('bank.zonderInkoop', { count: missingPurchaseDebits.length })}
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: '#7A4B00', margin: '6px 0 12px', lineHeight: 1.5 }}>
                {t('bank.zonderInkoopUitleg')}
              </div>
              <Link
                href="/dashboard/incoming"
                style={{
                  padding: '10px 16px', borderRadius: R.full, border: 'none',
                  background: '#B26A00', color: '#fff', fontSize: 13.5, fontWeight: 600,
                  fontFamily: FONT, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
                  textDecoration: 'none',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 17 }} aria-hidden>add</span>
                {t('bank.toevoegenOfOphalen')}
              </Link>
            </div>
          )}

          {/* "Geen factuur" context — POS receipts naturally have no invoice */}
          {bankTab === 'none' && noMatch.length > 0 && (
            <p style={{ fontSize: 12.5, color: '#5F6368', margin: '12px 2px 0', lineHeight: 1.5 }}>
              {t('bank.geenFactuurUitleg')}
            </p>
          )}

          {/* [COHERENCE-ORPHAN] Entry point to the bank-line categorisation screen. It
              was a real, P&L-feeding feature (give every uncategorised debit/credit an
              identity: kost, huur, fee, transfer…) with NO link anywhere — reachable only
              by typing the URL. Surface it here, where uncategorised "geen factuur" lines
              live, so those costs can actually reach the W&V/BTW. */}
          {/* [BANK-LEGE-LINK] Op uncatCount, niet op noMatch. Een regel zonder factuur kan al een
              categorie hebben — dan is er niets te categoriseren en leidde deze link naar een leeg
              scherm. Dat is niet alleen nutteloos: het is dezelfde teleurstelling als een tabblad
              zonder inhoud, en op deze plek verliest hij het vertrouwen in de banner bovenaan die
              hetzelfde scherm aanbiedt wanneer er WÉL werk is.
              De link blijft naast de banner bestaan, en dat is geen dubbeling om weg te halen: de
              banner staat bovenaan de pagina en deze staat waar de ondernemer op dat moment kijkt.
              Twee wegen naar dezelfde handeling is normaal; een weg naar niets is dat niet. */}
          {bankTab === 'none' && uncatCount > 0 && (
            <Link
              href="/dashboard/bank/categoriseren"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10,
                fontSize: 13, fontWeight: 600, color: M3.primary, textDecoration: 'none',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>label</span>
              {t('bank.categorie')} →
            </Link>
          )}

          {/* [SEARCH] In-page live filter — on every tab that has a list. */}
          {activeListRaw.length > 0 && (
            <div style={{ position: 'relative', marginTop: 12 }}>
              <span
                className="material-symbols-outlined"
                style={{ position: 'absolute', insetInlineStart: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 19, color: '#70757a', pointerEvents: 'none' }}
                aria-hidden>
                search
              </span>
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                /* [SMART-FILTER] Toegankelijk label — het icoon is puur decoratief. */
                aria-label={t('bank.zoek.aria')}
                placeholder={t('bank.zoek')}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '10px 36px 10px 38px',
                  borderRadius: R.full, border: `1px solid ${M3.surfaceVariant}`, background: '#fff',
                  fontFamily: FONT, fontSize: 13.5, color: M3.onSurface, outline: 'none',
                }}
              />
              {filterText && (
                <button
                  onClick={() => setFilterText('')}
                  aria-label={t('bank.zoek.wissen')}
                  style={{
                    position: 'absolute', insetInlineEnd: 8, top: '50%', transform: 'translateY(-50%)',
                    border: 'none', background: 'none', cursor: 'pointer', color: '#9aa0a6',
                    display: 'flex', alignItems: 'center', padding: 4,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>close</span>
                </button>
              )}
            </div>
          )}
          {/* Empty-filter hint — any tab */}
          {filterText.trim() && activeListRaw.length > 0 && activeList.length === 0 && (
            <p style={{ fontSize: 13, color: '#70757a', margin: '14px 2px 0' }}>
              {t('bank.zoekLeeg', { query: filterText.trim() })}
            </p>
          )}

          {bankTab === 'pin' && posList.length > 0 && (
            <p style={{ fontSize: 12.5, color: '#5F6368', margin: '12px 2px 0', lineHeight: 1.5 }}>
              {t('bank.pinUitleg')}
            </p>
          )}

          {/* [BANK-IGNORE-TRIAGE] Negeren is één tik en de regel is daarna weg uit ELKE lijst die
              hem nog had kunnen verklaren — de matcher, auto-confirm, auto-categorize, de
              nachtelijke sweep en elke categorize-lezing — én uit undocumentedCount, dus ook de
              BTW-waarschuwing voor die regel verdwijnt. Wat overblijft is een stapel die niemand
              ooit terugziet, zonder reden erbij, met soms honderden euro's erin.

              Dit telt die stapel één keer hardop: hoeveel regels, en hoeveel geld. Geen
              beschuldiging en geen blokkade — een genegeerde regel is vaak volkomen terecht
              genegeerd. Maar het bedrag hoort zichtbaar te zijn vóór het kwartaal dichtgaat, en
              tot nu toe was het dat nergens. Alleen tonen als er iets te tonen valt. */}
          {bankTab === 'ignored' && ignoredInQ.length > 0 && (() => {
            const total = round2(ignoredInQ.reduce((a, x) => a + Math.abs(x.amount), 0))
            const big = ignoredInQ.filter((x) => Math.abs(x.amount) >= 500).length
            return (
              <div style={{
                margin: '12px 2px 0', padding: '10px 12px', borderRadius: R.md,
                background: '#FEF7E0', border: '1px solid #FCE8B2', fontFamily: FONT,
                fontSize: 12.5, color: '#7C5800', lineHeight: 1.5,
              }}>
                {ignoredInQ.length === 1
                  ? t('bank.genegeerdSomEen', { total: eur.format(total) })
                  : t('bank.genegeerdSom', { count: ignoredInQ.length, total: eur.format(total) })}
                {big > 0 && <>{big === 1 ? t('bank.genegeerdGrootEen') : t('bank.genegeerdGroot', { count: big })}</>}.
                {' '}{t('bank.genegeerdNaloop')}
              </div>
            )
          })()}

          {/* Active group */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
            {/* [BANK-BATCH-CONFIRM] Bulk-confirm bar — only in "Te bevestigen", only
                when there are strong 'auto' matches that can be safely ticked. */}
            {bankTab === 'confirm' && batchEligibleList.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 14px', borderRadius: R.lg, background: M3.surfaceVariant, border: `1px solid ${M3.outline}` }}>
                <button
                  onClick={() => {
                    const allTicked = batchEligibleList.every((s) => selectedForBatch.has(s.transactionId))
                    setSelectedForBatch(
                      allTicked ? new Set() : new Set(batchEligibleList.map((s) => s.transactionId))
                    )
                  }}
                  disabled={batchRunning}
                  style={{ border: 'none', background: 'none', cursor: batchRunning ? 'default' : 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 600, color: M3.primary, padding: 0 }}
                >
                  {batchEligibleList.every((s) => selectedForBatch.has(s.transactionId)) && batchSelectedCount > 0
                    ? t('bank.selectieWissen')
                    : t('bank.selecteerAlle', { count: batchEligibleList.length })}
                </button>
                <span style={{ fontSize: 12.5, color: '#5F6368', marginInlineStart: 'auto' }}>
                  {batchSelectedCount > 0 ? t('bank.geselecteerd', { count: batchSelectedCount }) : t('bank.vinkAan')}
                </span>
                <button
                  onClick={confirmBatch}
                  disabled={batchSelectedCount === 0 || batchRunning}
                  style={{
                    border: 'none', borderRadius: R.full, cursor: batchSelectedCount === 0 || batchRunning ? 'default' : 'pointer',
                    fontFamily: FONT, fontSize: 13, fontWeight: 600, padding: '8px 16px',
                    background: batchSelectedCount === 0 || batchRunning ? '#dadce0' : M3.primary, color: '#fff',
                  }}
                >
                  {batchRunning ? t('bank.bezig') : t('bank.bevestigAantal', { count: batchSelectedCount })}
                </button>
              </div>
            )}
            {activeList.map((s) => (
              <TxCard
                key={s.transactionId}
                s={s}
                selectedInvoiceId={selected[s.transactionId]}
                processing={processingId === s.transactionId}
                isIgnoredTab={bankTab === 'ignored'}
                confirmedNumbers={confirmed[s.transactionId]?.numbers ?? []}
                batchEligible={bankTab === 'confirm' && isBatchEligible(s)}
                batchChecked={selectedForBatch.has(s.transactionId)}
                onBatchToggle={() =>
                  setSelectedForBatch((set) => {
                    const next = new Set(set)
                    if (next.has(s.transactionId)) next.delete(s.transactionId)
                    else next.add(s.transactionId)
                    return next
                  })
                }
                onSelect={(invId) => setSelected((sel) => ({ ...sel, [s.transactionId]: invId }))}
                onConfirm={(num, invId) => confirmMatch(s.transactionId, num, invId)}
                onConfirmSum={s.sumMatch ? () => confirmSumMatch(s.transactionId, s.sumMatch!.invoiceIds) : undefined}
                onAttach={(files) => attachFile(s.transactionId, files, s.amount >= 0)}
                onIgnore={(reason) => ignoreTx(s.transactionId, reason)}
                onRestore={() => restoreTx(s.transactionId)}
                onOpenFile={openInvoiceFile}
                onCorrect={openCorrection}
                onReject={(invId) => rejectSuggestion(s.transactionId, invId)}
                onUndoReject={undoReject[s.transactionId] ? () => undoRejectSuggestion(s.transactionId) : undefined}
                isDoneTab={bankTab === 'done'}
                onUnlink={() => unlink(s.transactionId, Math.abs(s.amount), (s.linkedInvoices ?? []).length)}
                onMove={() => openMove(s.transactionId)}
                onMatchChecked={() => markMatchChecked(s.transactionId)}
                onStorno={s.storno ? () => applyStorno(s.transactionId, s.storno!.originTxId) : undefined}
                onCreateFromLine={bankTab !== 'done' && !s.partiallyLinked ? () => openLijnFactuur(s.transactionId) : undefined}
                bijlagen={
                  <BijlageStrip
                    attachments={s.attachments ?? []}
                    t={t as (k: string) => string}
                    busy={processingId === s.transactionId}
                    onDeleteLine={bankTab !== 'done' && !s.partiallyLinked ? () => deleteLine(s.transactionId) : undefined}
                    onAddFile={(f) => addAttachment(s.transactionId, f)}
                    onOpen={(a) => openAttachment(s.transactionId, a)}
                    onRemove={(a) => removeAttachment(s.transactionId, a)}
                  />
                }
              />
            ))}
            {activeList.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 20px', color: '#70757a', fontSize: 13.5 }}>
                {bankTab === 'confirm' ? t('bank.leeg.confirm')
                  : bankTab === 'none' ? t('bank.leeg.none')
                  : bankTab === 'pin' ? t('bank.leeg.pin')
                  : bankTab === 'ignored' ? t('bank.leeg.ignored')
                  : t('bank.leeg.done')}
              </div>
            )}
          </div>
        </>
      )}

      {/* Empty (no transactions at all) */}
      {!initialLoading && data && (toConfirm.length + noMatch.length + posList.length + confirmedList.length + (ignoredList?.length ?? 0)) === 0 && (
        <Empty done={confirmedList.length > 0} />
      )}

      {/* B.4 verwerkt dialog */}
      {/* [DECLARED-INVOICE] The payment names an invoice we do not have. Booking the whole line
          here spends its money, so the owner gets the three honest ways forward — and the default
          is the safe one. Nothing was written when this opened. */}
      {/* [FULL-CORRECTION] One editor, shared with /dashboard/incoming/manage. */}
      {lijnFactuur && (
        <LijnFactuurSheet
          prefill={lijnFactuur}
          t={t as (k: string, v?: Record<string, string | number>) => string}
          busy={processingId === lijnFactuur.transactionId}
          onSubmit={submitLijnFactuur}
          onClose={() => setLijnFactuur(null)}
        />
      )}
      {correctFor && (
        <InvoiceCorrectionModal
          invoice={correctFor}
          btwRows={correctBtwRows}
          depositGap={correctDeposit}
          readingHint={correctHint}
          onClose={() => setCorrectFor(null)}
          onMessage={showToast}
          // The corrected amounts change what this payment can settle, so the match is recomputed
          // rather than patched in place — scorePair targets the REMAINING balance, and a stale
          // candidate list would keep scoring against the figure the owner just replaced.
          onSaved={() => { void runMatch() }}
        />
      )}
      {splitCtx && (
        <div
          role="dialog" aria-modal="true"
          onClick={() => { setSplitCtx(null); setSplitAmount('') }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.42)', zIndex: 1400, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '20px 20px 0 0', padding: '22px 20px', paddingBottom: sheetPaddingBottom(22), width: '100%', maxWidth: 460, fontFamily: FONT, maxHeight: '88vh', overflowY: 'auto' }}
          >
            <p style={{ fontSize: 18, fontWeight: 700, color: '#202124', margin: 0 }}>
              {t('bank.meerFacturen')}
            </p>
            <p style={{ fontSize: 13, color: '#5F6368', margin: '8px 0 16px', lineHeight: 1.5 }}>{splitCtx.detail}</p>

            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#3c4043', marginBottom: 6 }}>
              {splitCtx.invoiceNumber ? t('bank.welkDeelNummer', { number: splitCtx.invoiceNumber }) : t('bank.welkDeelFactuur')}
            </label>
            <input
              inputMode="decimal"
              value={splitAmount}
              onChange={(e) => setSplitAmount(e.target.value)}
              placeholder="0,00"
              style={{ width: '100%', boxSizing: 'border-box', padding: '13px 14px', borderRadius: 12, border: '1px solid #d1d1d6', fontSize: 16, fontFamily: FONT_NUM, marginBottom: 6 }}
            />
            <p style={{ fontSize: 12, color: '#5F6368', margin: '0 0 16px', lineHeight: 1.45 }}>
              {t('bank.restBlijft')}
            </p>

            <button
              onClick={() => {
                const amount = parseAmountInput(splitAmount)
                if (amount == null || amount <= 0) { showToast(t('bank.fout.bedragNul')); return }
                const ctx = splitCtx
                setSplitCtx(null); setSplitAmount('')
                void confirmMatch(ctx.txId, ctx.invoiceNumber, ctx.invoiceId, { amount })
              }}
              style={{ width: '100%', padding: '15px', borderRadius: 14, background: M3.primary, color: '#fff', border: 'none', fontWeight: 700, fontSize: 16, cursor: 'pointer', marginBottom: 8, fontFamily: FONT }}
            >
              {t('bank.deelBoeken')}
            </button>
            {/* The escape hatch, and it is not the prominent one: booking everything here is what
                leaves the other invoice with its money already spent. */}
            <button
              onClick={() => {
                const ctx = splitCtx
                setSplitCtx(null); setSplitAmount('')
                void confirmMatch(ctx.txId, ctx.invoiceNumber, ctx.invoiceId, { force: true })
              }}
              style={{ width: '100%', padding: '13px', borderRadius: 14, background: M3.surfaceVariant, color: '#3c4043', border: 'none', fontWeight: 600, fontSize: 15, cursor: 'pointer', marginBottom: 8, fontFamily: FONT }}
            >
              {t('bank.helesBedrag')}
            </button>
            {/* [DECLARED-INVOICE] The way out that actually solves it, without leaving the screen.
                Once the named invoice is in the administration the existing money rule handles the
                rest by itself: confirm the smaller invoice first, and the line stays open with the
                remainder for the other one. */}
            <input
              ref={missingFileRef}
              type="file"
              accept=".pdf,image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void addMissingInvoice(f)
              }}
            />
            <button
              onClick={() => missingFileRef.current?.click()}
              disabled={addingMissing}
              style={{ width: '100%', padding: '13px', borderRadius: 14, background: '#fff', color: M3.primary, border: `1.5px solid ${M3.primary}`, fontWeight: 700, fontSize: 15, cursor: addingMissing ? 'default' : 'pointer', marginBottom: 8, fontFamily: FONT, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>upload_file</span>
              {addingMissing
                ? t('bank.inlezen')
                : splitCtx.missingNumbers.length === 1 ? t('bank.voegFactuurToe') : t('bank.voegFacturenToe')}
            </button>
            <button
              onClick={() => { setSplitCtx(null); setSplitAmount('') }}
              style={{ width: '100%', padding: '13px', borderRadius: 14, background: 'transparent', color: '#5F6368', border: 'none', fontWeight: 600, fontSize: 15, cursor: 'pointer', fontFamily: FONT }}
            >
              {t('lijst.annuleren')}
            </button>
          </div>
        </div>
      )}
      {verwerktCtx && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setVerwerktCtx(null)}
        >
          <div className="sheet-scroll" onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: R.lg, padding: 24, maxWidth: 380, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.24)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 8px' }}>{t('lijst.verwerkt')}</h3>
            <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.5, margin: '0 0 20px' }}>
              {t('lijst.verwerktUitleg', { number: verwerktCtx.number })}
            </p>
            <button
              onClick={() => setVerwerktCtx(null)}
              style={{ width: '100%', padding: 12, borderRadius: R.full, background: M3.primary, color: '#fff', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT }}
            >
              {t('lijst.sluiten')}
            </button>
          </div>
        </div>
      )}

      {/* [BANK-STATEMENT-DELETE] Confirm dialog — the delete is permanent, so we
          require an explicit confirmation and remind the owner to make sure they
          have the correct version uploaded. */}
      {statementToDelete && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => { if (!deletingStatementId) setStatementToDelete(null) }}
        >
          <div className="sheet-scroll" onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: R.lg, padding: 24, maxWidth: 400, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.24)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 22, color: M3.error }} aria-hidden>warning</span>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{t('bank.afschrift.verwijderenVraag')}</h3>
            </div>
            <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.5, margin: '0 0 6px' }}>
              {t('bank.afschrift.verwijderenZeker')}
            </p>
            <p style={{ fontSize: 13, color: '#5F6368', lineHeight: 1.5, margin: '0 0 4px', wordBreak: 'break-word' }}>
              <strong style={{ color: '#3c4043' }}>{statementToDelete.name}</strong>
            </p>
            <p style={{ fontSize: 13, color: '#5F6368', lineHeight: 1.5, margin: '0 0 20px' }}>
              {t('bank.afschrift.verwijderenUitleg')}
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setStatementToDelete(null)}
                disabled={!!deletingStatementId}
                style={{
                  flex: 1, padding: 12, borderRadius: R.full, background: '#fff', color: M3.primary,
                  fontSize: 14, fontWeight: 600, border: `1.5px solid #E0E0E0`, cursor: deletingStatementId ? 'default' : 'pointer',
                  fontFamily: FONT, opacity: deletingStatementId ? 0.6 : 1,
                }}
              >
                {t('lijst.annuleren')}
              </button>
              <button
                onClick={() => deleteStatement(statementToDelete.id)}
                disabled={!!deletingStatementId}
                style={{
                  flex: 1, padding: 12, borderRadius: R.full, background: M3.error, color: '#fff',
                  fontSize: 14, fontWeight: 600, border: 'none', cursor: deletingStatementId ? 'default' : 'pointer',
                  fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  opacity: deletingStatementId ? 0.7 : 1,
                }}
              >
                {deletingStatementId
                  ? <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>hourglass_empty</span>
                  : <><span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>delete</span> {t('lijst.verwijderen')}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* [BANK-FORMAT-GUARD] Unreadable-format notice — a clear modal (not a toast)
          telling the owner the file was kept for the accountant but its transactions
          could not be read, and which formats to use for the bank overview. */}
      {formatNotice && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setFormatNotice(null)}
        >
          <div className="sheet-scroll" onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: R.lg, padding: 24, maxWidth: 420, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.24)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 22, color: M3.primary }} aria-hidden>info</span>
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{t('bank.fout.nietUitgelezen')}</h3>
            </div>
            <p style={{ fontSize: 13, color: '#5F6368', lineHeight: 1.5, margin: '0 0 4px', wordBreak: 'break-word' }}>
              <strong style={{ color: '#3c4043' }}>{formatNotice.name}</strong>
            </p>
            <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.5, margin: '0 0 10px' }}>
              {t('bank.formaat.bewaard')}
            </p>
            <p style={{ fontSize: 14, color: '#5F6368', lineHeight: 1.5, margin: '0 0 20px' }}>
              {t('bank.upload.als')} <strong style={{ color: '#3c4043' }}>CAMT.053 (.xml)</strong>, <strong style={{ color: '#3c4043' }}>MT940 (.940 / .sta / .txt)</strong> {t('bank.of')} <strong style={{ color: '#3c4043' }}>CSV</strong> {t('bank.formaat.omTeKoppelen')}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setFormatNotice(null)}
                style={{
                  padding: '12px 24px', borderRadius: R.full, background: M3.primary, color: '#fff',
                  fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: FONT,
                }}
              >
                {t('bank.begrepen')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Empty({ done }: { done: boolean }) {
  const t = translator(useLocale())
  return (
    <div style={{ marginTop: 28, textAlign: 'center', color: '#9aa0a6' }}>
      <span className="material-symbols-outlined" style={{ fontSize: 40 }} aria-hidden>{done ? 'done_all' : 'inbox'}</span>
      <p style={{ fontSize: 13.5, marginTop: 6 }}>{done ? t('bank.leeg.klaar') : t('bank.leeg.geen')}</p>
    </div>
  )
}

// Geëxporteerd om dezelfde reden als InvoiceCard in de verificatiewachtrij: de takken van deze
// kaart zijn alleen te bewijzen door hem te RENDEREN met rijen die ze raken — tsc en de build
// roepen een component nooit aan.
export function TxCard({
  s, selectedInvoiceId, processing, isIgnoredTab, confirmedNumbers, batchEligible, batchChecked, onBatchToggle, onSelect, onConfirm, onConfirmSum, onAttach, onIgnore, onRestore, onOpenFile, onCorrect, onReject, onUndoReject, isDoneTab, onUnlink, onMove, onMatchChecked, bijlagen, onStorno, onCreateFromLine,
}: {
  s: Suggestion
  /** [REGEL-FACTUUR] Present on a free line: book it as an invoice without a file. */
  onCreateFromLine?: () => void
  /** [STORNO] Present when the server paired this credit with the incasso it reverses. */
  onStorno?: () => void
  /** [BIJLAGE-BIJ-REGEL] The owner's own controls under the card, built by the screen. */
  bijlagen?: React.ReactNode
  selectedInvoiceId: string | undefined
  /** [NIET-DEZE-FACTUUR] "This is not the invoice for this payment." Removes the suggestion; books
   *  nothing. Optional: a screen that does not pass it simply has no such button. */
  onReject?: (invoiceId: string) => void
  /** [NIET-DEZE-FACTUUR] Put the last refused suggestion back. Absent when there is nothing to undo. */
  onUndoReject?: () => void
  processing: boolean
  isIgnoredTab: boolean
  confirmedNumbers: string[]
  batchEligible: boolean
  batchChecked: boolean
  onBatchToggle: () => void
  onSelect: (invoiceId: string) => void
  onConfirm: (invoiceNumber: string | null, invoiceId?: string) => void
  // [BANK-SUM-SUGGEST] Book the suggested same-supplier sum (each invoice via the normal confirm).
  onConfirmSum?: () => void
  onAttach: (files: File[]) => void
  onIgnore: (reason: string | null) => void
  onRestore: () => void
  onOpenFile: (invoiceId: string) => void
  // [FULL-CORRECTION] Opens the shared correction editor for a matched invoice.
  onCorrect: (invoiceId: string) => void
  isDoneTab?: boolean
  onUnlink?: () => void
  /** [MOVE-PAYMENT] Move this line's booked payment to another invoice. */
  onMove?: () => void
  /** [KAS-AUTO-BOOK] "Klopt" on the amount-only flag — the answer the warning never had. */
  onMatchChecked?: () => void
}) {
  // [WAAROM-WACHT-BANK] De taal apart: de zin over deze regel komt uit een pure module en draagt
  // zijn eigen leesrichting mee, zodat een Arabische kaart niet half links uitlijnt.
  const taal = useLocale()
  const t = translator(taal)
  const isCredit = s.amount >= 0
  const amountColor = isCredit ? M3.success : M3.error
  // [BANK-DETAILS] Like the ING app, the card shows a clean name and lets the
  // owner expand the FULL original description (Pasvolgnr, Transactienr, Google
  // Pay, etc.) on demand — useful to verify a payment, and it reveals the real
  // counterpart even on older rows whose stored name is still "Onbekende".
  const [showDetails, setShowDetails] = useState(false)
  // [BANK-IGNORE-REDEN] Eén extra tik, nooit meer. Negeren opent de vraag; een chip negeert MÉT
  // reden, "Zonder reden" negeert zonder. Bewust geen verplicht veld: een afgedwongen reden levert
  // een antwoord op dat slechter is dan geen antwoord, en de uitweg staat naast de chips in plaats
  // van verstopt achter een kruisje.
  const [askReason, setAskReason] = useState(false)
  const hasDetails = !!(s.description && s.description.trim())
  // [BANK-SLOT-DISMISS] The reference extractor (a regex) can grab numbers that
  // are NOT invoices — a customer number after "Klant:", a postcode like "5049NM".
  // The owner knows their own suppliers, so we let them remove a wrong number from
  // this transaction's list with an ✗. This is a VIEW-only dismissal for the
  // session: it never touches the stored reference (kept intact for the accountant
  // and the matcher) or the DB. It doesn't need to persist — once the owner links
  // the real invoice (or hits Negeren), the whole transaction leaves the list, so
  // a dismissal is only ever needed once. The full raw description stays under
  // "Details", so nothing is hidden and a mistaken ✗ is recoverable with a reload.
  const [dismissedNumbers, setDismissedNumbers] = useState<Set<string>>(new Set())
  // [BANK-REF-DISPLAY] Build a compact label from the extracted reference. One
  // number → show it; several (comma-separated, a multi-invoice payment) → show
  // "N facturen" so the card stays clean and signals the multi-invoice case.
  // Normalize a reference number the same way the matcher does (lowercase, keep
  // [a-z0-9]) — used for candidate matching AND for the dismiss set.
  const normRef = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')
  // [BANK-REF-ONE-SOURCE] Show the RAW text the bank wrote (normalizing it on screen would be
  // unreadable), but only the parts the server would accept as an invoice number — otherwise a
  // reference like "Huur juli, Kerkstraat 12" advertised "2 facturen" that do not exist.
  const allRefParts = (s.reference ?? '').split(',').map((r) => r.trim()).filter(isReferenceNumberToken)
  // [BANK-SLOT-DISMISS] Hide any number the owner removed with ✗ (view-only). The
  // raw reference is untouched; this only changes what THIS card shows this session.
  const refParts = allRefParts.filter((r) => !dismissedNumbers.has(normRef(r)))
  const doneNumbers = s.coveredNumbers ?? []
  const selectedCand =
    s.candidates.find((c) => c.invoiceId === selectedInvoiceId) ??
    // [AL-GEBOEKT-KLEMT] No silent fallback to the winner while the payment names an already-booked
    // invoice: that fallback is what put a confirmable amount under a green check on a bill the
    // statement never mentioned. An explicit tap on a candidate still selects it — that path is untouched.
    (s.outcome === 'auto' && !s.quotedSettled ? s.best : null)

  // [BANK-MULTI-CONFIRM] A transaction whose reference lists more than one invoice
  // number covers several invoices. Instead of "pick ONE" (which silently drops the
  // others), show a row PER reference number with its own state. Mirrors the
  // backend's allCovered logic on the display side so the owner sees exactly what is
  // confirmed and what is still open. Only relevant in the confirm flow (not the
  // ignored tab, and not when there is no real candidate at all).
  //
  // [BANK-SLOT-DISMISS] `wasMulti` is based on the ORIGINAL reference: once a
  // transaction shows the multi-row UI, it keeps it even after the owner dismisses
  // numbers down to one (or zero) — so the Negeren escape hatch stays available and
  // a fully-dismissed transaction (e.g. Brabant Water, where every number was a
  // customer/postcode, not an invoice) can still be cleared. Slots are built from
  // the current refParts, so dismissed numbers simply disappear as rows.
  // [BANK-PSP-MATCH] A genuine multi-invoice batch = ≥2 of the bank's reference numbers
  // resolve to REAL invoices (a live candidate, or a number already confirmed against this
  // tx), OR the server flagged this tx as a partially-linked multi (one invoice already
  // paid, others still open). A PSP / order-gateway reference (Mollie transaction hash +
  // order number) resolves <2 real invoices, so it falls through to the normal match UI and
  // the amount-matched invoice is offered instead of hidden. Counting RESOLVED references —
  // not raw fragments (which forced the slot view on junk), and not any full-amount
  // candidate (which let an UNRELATED invoice equal to the whole debit collapse a real
  // batch and steer to the wrong pick — caught in adversarial review) — fixes both bugs.
  // [BUNDEL-REF-RECOVER] Resolve against the FULL payment text, not only the extracted
  // reference. extractInvoiceReference cuts an invoice number at every separator and drops a
  // leading year, so "2026-045, 2026-046" is stored as "045, 046" — two fragments that match
  // nothing, which left the owner staring at two "Koppelen" rows for a bundle the app itself
  // had asked them to pay. Every SUPPLIER invoice carries the supplier's own numbering, so this
  // is the normal case on the incoming side, not an exotic one.
  const resolvedNumbers = resolveBatchNumbers(
    { reference: s.reference, description: s.description },
    [...s.candidates.map((c) => c.invoiceNumber), ...confirmedNumbers, ...(s.coveredNumbers ?? [])],
  )
  const resolvedRefCount = resolvedNumbers.length
  // [PAYMENT-NAMES-MISSING] Which invoices does the payment TEXT name, whether or not we hold
  // them? resolveBatchNumbers above can only ever find numbers we already have — it iterates over
  // them — so a payment naming a bill that was never imported resolves to one, falls out of the
  // multi view, and the card offers to book the whole amount on the invoice it does recognise.
  // The label three lines down already said "2 facturen" for exactly such a payment.
  const namedInvoices = namedInvoiceNumbers(
    `${s.reference ?? ''} ${s.description ?? ''}`,
    [...s.candidates.map((c) => c.invoiceNumber), ...confirmedNumbers, ...(s.coveredNumbers ?? [])],
  )
  const missingNamed = missingNamedInvoices(namedInvoices).filter(
    (n) => !dismissedNumbers.has(normRef(n)),
  )
  // [CREDIT-TEKEN] De facturen die quotedInvoiceSet al heeft OPGEZOCHT — en dat is geen detail: op
  // één schermafbeelding uit productie stond de kaart "Factuur 26700644 · € 306,27" met daaronder,
  // in oranje, "deze betaling noemt ook factuur 26700644, en die staat niet in je administratie".
  // Twee panelen van één kaart die elkaar tegenspreken over dezelfde factuur.
  //
  // De oorzaak is dat de twee lezers uit verschillende bakken putten: de lijst hierboven kent de
  // kandidaten en wat er op DEZE regel al is afgeboekt, terwijl quotedSet de betaalde facturen van
  // de hele administratie doorzoekt. Een nummer dat quotedSet heeft gevonden is per definitie een
  // factuur die we HEBBEN, en daarover mag deze zin niet beweren dat hij ontbreekt.
  //
  // Alleen de ZIN wordt hiermee gecorrigeerd, niet missingNamed zelf. Dat is opzet: missingNamed
  // draagt ook wasMulti en de slots, en een betaling die twee documenten noemt hoort de slotweergave
  // te houden — daar hoort deze regel nog thuis, alleen niet meer met dit woord erbij.
  const quotedNumbers = s.quotedSet
    ? [...s.quotedSet.settled, ...s.quotedSet.open].map((q) => normRef(q.invoiceNumber))
    : []
  const missingForNotice = missingNamed.filter((n) => !quotedNumbers.includes(normRef(n)))
  // [PAYMENT-NAMES-MISSING] …and a payment that names ≥2 invoices is a batch even when one of them
  // is not in the administration yet. Counting only RESOLVED numbers meant the missing invoice
  // silently downgraded the card to single-invoice mode, where "Bevestig betaling" books the whole
  // debit onto the one we have — overpaying it, and spending the money that belonged to the other.
  // The PSP guard the resolved-count protected is kept: namedInvoiceNumbers claims an unresolved
  // run only on evidence (an introducing "factuur", or a sibling of ours with the same shape).
  const wasMulti =
    !isIgnoredTab &&
    (resolvedRefCount >= 2 || s.partiallyLinked === true || resolvedRefCount + missingNamed.length >= 2)
  // Equality — not substring — so "263" can't claim "26302050".
  // [BANK-SLOT-PERSIST] Merge the SESSION's just-confirmed numbers with the server's
  // covered numbers (paid invoices, reload-safe) so an already-paid slot shows "Betaald"
  // after a refresh instead of a false "Koppelen" / "nog open" that would double-book it.
  // [SLOT-BETAALD] …en de facturen die quotedInvoiceSet AFGEBOEKT terugmeldt.
  //
  // Gezien op de Altena-kaart: de slotweergave bood "Koppelen" aan bij factuur 26700644, die in de
  // administratie gewoon op 'paid' staat. Die knop kan alleen maar mislukken — een betaalde factuur
  // is geen kandidaat meer, dus er is niets om aan te koppelen — en hij staat er juist op het
  // moment dat de kaart erboven diezelfde factuur mét bedrag afdrukt.
  //
  // De rij wordt hiermee "Betaald", en dat is precies wat er waar is: over DEZE betaling zegt het
  // niets, over de factuur alles. Wat het weghaalt is een knop die niet kan werken en een ✗ waarmee
  // de eigenaar een echte factuur uit beeld zou vegen.
  const quotedSettledKeys = (s.quotedSet?.settled ?? []).map((q) => normRef(q.invoiceNumber))
  const confirmedSet = new Set([...confirmedNumbers, ...(s.coveredNumbers ?? [])].map(normRef).concat(quotedSettledKeys))
  // [BANK-SLOT-DISMISS] Build slots whenever the transaction STARTED multi, so a
  // single remaining number (after others were dismissed) still shows its own
  // linkable row — not just an empty banner. Driven by wasMulti, not isMulti.
  // [BUNDEL-REF-RECOVER] Show the invoice's REAL number as the slot, and drop the fragment the
  // extractor carved out of it ("045" ⊂ "2026045") so the same invoice never appears twice —
  // once as a linkable row and once as a permanently-unlinkable one that would keep the batch
  // "incomplete" forever. A reference number that resolves to nothing is kept: it is a real
  // invoice we don't have yet, and hiding it would fake a complete batch.
  // [SLOT-WAAR] Eén rij per FACTUURNUMMER, en die regel staat in bank-slot-numbers.ts.
  //
  // Hier stonden drie lijsten naast elkaar met één filter ertussen — en dat filter keek alleen naar
  // de opgeloste nummers. Zodra er niets oploste (de gewone toestand bij een factuur die nooit is
  // geïmporteerd) had het niets om tegen te vergelijken, overleefde elk stuk van het bankkenmerk, en
  // verscheen hetzelfde nummer twee keer: "2 facturen" boven een betaling die er één noemt, met
  // twee React-rijen op dezelfde key. Gemeld op ipekci slachterij, € 3.624,25, "Deel twee factuur
  // 202604231".
  const slotNumbers = slotNumbersOf({
    resolved: resolvedNumbers.filter((n) => !dismissedNumbers.has(normRef(n))),
    // [PAYMENT-NAMES-MISSING] De facturen die de betaling noemt en die wij niet hebben. De
    // slotweergave weet raad met een nummer zonder factuur erachter — die rij toont "Koppelen".
    missing: missingNamed,
    referenceParts: refParts,
  })
  // [BANK-REF-DISPLAY] The compact label on the card. One number → show it; several → "N
  // facturen" so the card stays clean and signals the multi-invoice case. Built from the
  // resolved numbers, so a bundle shows the invoice numbers the owner recognises rather than
  // the fragments the extractor left behind.
  // [BANK-R1] On the "Gekoppeld" tab a matched line may have a sparse bank reference (an auto 1:1
  // match keyed on amount) — fall back to the actually-linked invoice number(s) so the owner still
  // sees WHICH invoice was booked, not a bare payment with no clue what happened.
  const refLabel =
    slotNumbers.length === 0
      ? (isDoneTab && doneNumbers.length > 0
          ? (doneNumbers.length === 1 ? doneNumbers[0] : t('bank.nFacturen', { count: doneNumbers.length }))
          : null)
      : slotNumbers.length === 1 ? slotNumbers[0]
      : t('bank.nFacturen', { count: slotNumbers.length })
  const slots = wasMulti
    ? slotNumbers.map((refNum) => {
        const key = normRef(refNum)
        const cand = s.candidates.find((c) => normRef(c.invoiceNumber ?? '') === key) ?? null
        const isConfirmed = confirmedSet.has(key)
        return { refNum, cand, isConfirmed }
      })
    : []
  const openCount = slots.filter((sl) => !sl.isConfirmed).length
  // [BANK-ONE-PAYMENT-MANY-INVOICES] Euros of this bank line that no invoice has claimed yet.
  // null when the server could not measure it (links written before amount_applied existed) —
  // then the card says nothing rather than a wrong number.
  const unassignedAmount =
    s.appliedAmount == null
      ? null
      : round2(Math.abs(s.amount) - s.appliedAmount)
  // [BANK-BATCH-RECONCILE] Sum the matched invoices and check the total equals the bank
  // debit. This is the honest proof a batch payment covers exactly these invoices — no
  // single invoice amount appears in the statement, only the sum was debited. Only shown
  // BEFORE any slot is confirmed: once the owner starts confirming, a paid invoice drops
  // out of the candidate set (its amount is gone), so the sum can no longer be trusted —
  // the "X/Y bevestigd" progress banner tells the story from there.
  const batch = wasMulti
    ? reconcileBatch(
        // [PARTIAL-PAY] Reconcile on what each invoice still has OPEN, not its full total: that
        // is what the bank line moved, and it is exactly what the app's own gebundeld
        // betaalverzoek asked the customer for. Summing totals told the owner "de bedragen
        // kloppen niet" about a payment that was precisely right. `remaining` is absent on
        // candidates built outside matchTransactions → fall back to the total (open == total
        // for a fully open invoice anyway).
        // [BATCH-SIGN-KEPT] settleableAmount, NOT `remaining`: `remaining` is a magnitude, so a
        // creditnota slot (negative gross) lost its sign here and the [BATCH-SIGN] netting in
        // reconcileBatch — invoice €300 + creditnota −€20 against a −€280 debit — could never
        // fire from this card: the only screen that reconciles a korting-bundle showed a false
        // mismatch. settleableAmount carries the invoice's own sign through the open-balance
        // arithmetic; for a normal (positive) invoice it equals `remaining` exactly.
        slots.map((sl) => ({ refNum: sl.refNum, amount: sl.cand ? settleableAmount(sl.cand.amount, sl.cand.amountPaid) : null, isConfirmed: sl.isConfirmed })),
        s.amount,
      )
    : null
  const showReconcile = batch != null && !batch.anyConfirmed && slots.length > 0

  return (
    <div style={{ borderRadius: R.lg, background: M3.surface, boxShadow: EL1, padding: 14, border: `1px solid #EEE` }}>
      {/* [BANK-UNLINK] On the Gekoppeld tab, one tap undoes the match — makes the app's
          automatic booking safe: any auto-confirmed payment is reversible.
          [BANK-ONE-PAYMENT-MANY-INVOICES] Also offered while a payment is only PARTLY assigned:
          such a line stays in "Te bevestigen" (money of it has no invoice yet), and without the
          button here a mis-tapped first confirmation would have no way back — the undo lived on
          a tab the line no longer reaches. It reverses everything booked against this line. */}
      {(isDoneTab || s.partiallyLinked === true) && onUnlink && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8, flexWrap: 'wrap', gap: 4 }}>
          {/* [OPEN-FACTUUR] The document behind the booking, one tap away from the line that paid it. */}
          {isDoneTab && (s.linkedInvoices ?? []).map((li) => (
            <button
              key={li.invoiceId}
              onClick={() => onOpenFile(li.invoiceId)}
              disabled={processing}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', cursor: processing ? 'default' : 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 600, color: M3.primary, padding: '2px 4px', marginInlineEnd: 'auto' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden>description</span>
              {t('bank.openFactuur')}{li.invoiceNumber ? ` ${li.invoiceNumber}` : ''}
            </button>
          ))}
          <button
            onClick={onUnlink}
            disabled={processing}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', cursor: processing ? 'default' : 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 600, color: '#70757a', padding: '2px 4px' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden>link_off</span>
            {processing ? t('bank.bezig') : t('bank.ontkoppelen')}
          </button>
          {/* [MOVE-PAYMENT] The other answer, and a different question from Ontkoppelen. That one
              says "this booking should not exist" and leaves the line unmatched; this one says
              "it belongs to another invoice" and puts it there in one atomic step, instead of
              unlink -> find the line again -> re-book with the money on nothing in between. */}
          {onMove && (
            <button
              onClick={onMove}
              disabled={processing}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', cursor: processing ? 'default' : 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 600, color: '#70757a', padding: '2px 4px', marginInlineStart: 6 }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden>swap_horiz</span>
              {t('bank.andereFactuur')}
            </button>
          )}
        </div>
      )}
      {/* [BANK-AMOUNT-ONLY] This line was auto-linked on the exact amount + a matching supplier
          name (no invoice number/IBAN in the statement). Almost always right, but for a recurring
          same-amount supplier it could be the wrong month — so flag it for a quick check. One tap
          on Ontkoppelen above undoes it. Only on the Gekoppeld tab. */}
      {isDoneTab && s.matchReason === 'amount_only' && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10,
          background: '#FEF7E0', border: '1px solid #FBBC04', borderRadius: R.sm, padding: '8px 10px',
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#B06000', flexShrink: 0 }} aria-hidden>rule</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 12, color: '#7A4F00', lineHeight: 1.4 }}>
              {t('bank.automatischOp')} <strong>{t('bank.bedragNaam')}</strong> {t('bank.automatischOpRest')}
            </span>
            {/* [KAS-AUTO-BOOK] The warning had one answer — "Ontkoppelen" above — and the other
                answer, "I looked and it is right", had no button at all. That gap is what makes a
                warning permanent, and a permanent warning is one nobody reads. It matters more here
                than it looks: the quarter-close now counts these before an aangifte goes out
                (they are allowed to book themselves under the kasstelsel precisely because they
                stay reversible until then), so without this tap the risk would sit on every
                quarter for the rest of the administration's life. */}
            {onMatchChecked && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onMatchChecked() }}
                disabled={processing}
                style={{
                  marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: '#FFF', border: '1px solid #FBBC04', borderRadius: R.sm,
                  padding: '5px 10px', fontSize: 12, fontWeight: 600, color: '#7A4F00',
                  cursor: processing ? 'default' : 'pointer', opacity: processing ? 0.6 : 1,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>check</span>
                {t('bank.kloptGecontroleerd')}
              </button>
            )}
          </div>
        </div>
      )}
      {/* Transaction row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 10, minWidth: 0, alignItems: 'flex-start' }}>
          {/* [BANK-BATCH-CONFIRM] Tick to include this strong match in a bulk confirm.
              Only rendered for batch-eligible (auto, single-invoice) transactions. */}
          {batchEligible && (
            <input
              type="checkbox"
              checked={batchChecked}
              onChange={onBatchToggle}
              disabled={processing}
              aria-label={t('bank.selecteerBevestigen')}
              style={{ marginTop: 2, width: 18, height: 18, accentColor: M3.primary, cursor: processing ? 'default' : 'pointer', flexShrink: 0 }}
            />
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.counterpart || t('verd.onbekendeTegenpartij')}
            </div>
          <div style={{ fontSize: 12, color: '#5F6368', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span>{s.date}</span>
            {/* [BANK-REF-DISPLAY] Show the clean extracted invoice number(s) as a
                chip — not the raw "USTD//..." description. Multiple invoices in one
                payment render a count ("3 facturen") so the owner sees instantly
                that this transaction covers several invoices. */}
            {refLabel && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px',
                borderRadius: R.full, background: M3.surfaceVariant, color: '#3c4043',
                fontSize: 11.5, fontWeight: 600, fontFamily: FONT_NUM,
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: 13 }} aria-hidden>receipt_long</span>
                {refLabel}
              </span>
            )}
            {/* [BANK-PERIOD] A recurring debit (rent/lease/subscription) states the month
                it covers. Surface it so the owner can match it to the right invoice among
                same-amount candidates — we never auto-match it (invoices have no period). */}
            {(() => {
              const period = parsePaymentPeriod(s.description)
              return period ? (
                <span title={t('bank.periodeDekt')} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px',
                  borderRadius: R.full, background: '#E8F0FE', color: '#1967D2',
                  fontSize: 11.5, fontWeight: 600, fontFamily: FONT,
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }} aria-hidden>event</span>
                  {period.label}
                </span>
              ) : null
            })()}
            {/* [BANK-DETAILS] Toggle the full original bank description. */}
            {hasDetails && (
              <button
                onClick={() => setShowDetails((v) => !v)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 2, border: 'none', background: 'none',
                  cursor: 'pointer', fontFamily: FONT, fontSize: 11.5, fontWeight: 600, color: M3.primary, padding: 0,
                }}
              >
                {t('bank.details')}
                <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden>
                  {showDetails ? 'expand_less' : 'expand_more'}
                </span>
              </button>
            )}
          </div>
          </div>
        </div>
        <div style={{ fontFamily: FONT_NUM, fontSize: 14.5, fontWeight: 700, color: amountColor, whiteSpace: 'nowrap' }}>
          {isCredit ? '+' : '−'}{eur.format(Math.abs(s.amount))}
        </div>
      </div>

      {/* [BANK-DETAILS] Full original description (as the bank recorded it). */}
      {showDetails && hasDetails && (
        <div style={{
          marginTop: 10, padding: '8px 10px', borderRadius: R.md, background: '#F8F9FA',
          fontSize: 12, color: '#5F6368', lineHeight: 1.5, wordBreak: 'break-word',
          fontFamily: FONT, border: '1px solid #EEE',
        }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#70757a', marginBottom: 3, letterSpacing: 0.4 }}>
            {t('bank.omschrijvingKop')}
          </div>
          {cleanBankDescription(s.description)}
        </div>
      )}

      {/* [BANK-COUNTERPART-HISTORY] "Wat deed ik hier de vorige keer mee?" — the app has always
          known this (counterpart_iban is stored on every import and an IBAN hit is a CERTAIN-tier
          signal in the matcher) and never showed it. For an unidentifiable line this is the
          cheapest resolution there is, and it comes before any heavier answer.

          Reported, never applied: no tap, no pre-fill. counterpart_memory already drives the
          actual suggestion, and a second hint the owner could act on separately would eventually
          contradict it. The wording keeps two things apart that must not blur — an IBAN is an
          identity ("deze tegenrekening"), a name is only a resemblance ("deze naam"), because the
          bank rewrites counterpart names constantly. And when the past was NOT unanimous we say
          so rather than rounding a 2-of-3 into "altijd". */}
      {s.history && (
        <div style={{
          marginTop: 8, padding: '8px 10px', borderRadius: R.md, background: '#F1F6FE',
          fontSize: 12, color: '#1F4E8C', lineHeight: 1.5, fontFamily: FONT, border: '1px solid #D6E4FA',
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, color: '#1A73E8', flexShrink: 0, marginTop: 1 }} aria-hidden>history</span>
          <span>
            {s.history.topCount === s.history.count
              ? (s.history.count === 1
                  ? t(s.history.matchedBy === 'iban' ? 'bank.historie.eenIban' : 'bank.historie.eenNaam', { category: categoryLabel(s.history.topCategory) })
                  : t(s.history.matchedBy === 'iban' ? 'bank.historie.steedsIban' : 'bank.historie.steedsNaam', { count: s.history.count, category: categoryLabel(s.history.topCategory) }))
              : t(s.history.matchedBy === 'iban' ? 'bank.historie.meestIban' : 'bank.historie.meestNaam', { count: s.history.count, topCount: s.history.topCount, category: categoryLabel(s.history.topCategory) })}
          </span>
        </div>
      )}

      {/* [BANK-MULTI-CONFIRM] Multi-invoice transaction — one row per reference
          number, each with its own state: confirmed (✓), confirmable (a candidate
          exists → Bevestig), or missing (no invoice in the system → koppel het
          bestand). The transaction stays here until every row is confirmed.
          [BANK-SLOT-DISMISS] Shown for any transaction that STARTED multi, so the
          UI (and Negeren) persists even after numbers are dismissed down to ≤1. */}
      {/* [PAYMENT-NAMES-MISSING] The sentence that unblocks the owner. Without it the slot view
          shows a row that cannot be filled and no reason why — and "Koppelen" on an invoice that
          does not exist is a button that can only fail. Naming the bill and the consequence is
          what turns a dead end into one action: add the invoice, then come back. */}
      {/* [SOM-KLOPT] De multi-factuurweg had deze kaart helemaal niet, en dat is precies de regel
          uit de melding: € 466,30 met "2601695, 2601826, 2601291" in de omschrijving kreeg de
          slotjes-kiezer én "Facturen koppelen (3)" te zien, terwijl alle drie al waren afgeboekt
          en samen exact dit bedrag zijn. Eerst zeggen wat er aan de hand is; pas daarna, als de
          som NIET klopt, mag er iets te koppelen zijn. */}
      {wasMulti && s.quotedSet && (
        <SomKloptKaart set={s.quotedSet} betaling={s.amount} onOpenFile={onOpenFile} />
      )}

      {wasMulti && !s.quotedSet?.fullySettled && missingForNotice.length > 0 && (
        <div style={{
          marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '10px 12px', borderRadius: R.md,
          background: M3.warningContainer, color: '#7C5800', fontSize: 12.5, lineHeight: 1.45,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }} aria-hidden>info</span>
          <span>{missingInvoiceNoticeText(missingForNotice)}</span>
        </div>
      )}

      {wasMulti && !s.quotedSet?.fullySettled && (
        <div style={{ marginTop: 12 }}>
          {slots.length === 0 ? (
            /* Every number was dismissed as "not an invoice". Nothing left to link —
               offer the clean exit. The raw description stays under Details. */
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
              padding: '8px 10px', borderRadius: R.md, background: '#F8F9FA',
              color: '#5F6368', fontSize: 12.5, fontWeight: 600, marginBottom: 10,
              border: '1px solid #EEE',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>info</span>
              {t('bank.fout.geenNummers')}
            </div>
          ) : (
          <>
          {/* Status banner: X/Y bevestigd + open numbers. Honest: we list the
              numbers the BANK wrote in the reference, not an invented total. */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
            padding: '8px 10px', borderRadius: R.md,
            background: openCount === 0 ? M3.successContainer : M3.primaryContainer,
            color: openCount === 0 ? M3.success : M3.onPrimaryContainer,
            fontSize: 12.5, fontWeight: 600, marginBottom: 10,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>
              {openCount === 0 ? 'task_alt' : 'receipt_long'}
            </span>
            {t('bank.slotsBevestigd', { done: slots.length - openCount, total: slots.length })}
            {openCount > 0 && (
              <span style={{ fontWeight: 500, opacity: 0.9 }}>
                · {t('bank.nogOpenLijst', { numbers: slots.filter((sl) => !sl.isConfirmed).map((sl) => sl.refNum).join(', ') })}
              </span>
            )}
            {/* [BANK-ONE-PAYMENT-MANY-INVOICES] What is still UNASSIGNED of this payment. The
                line stays here because money of it has no invoice yet — the euros say it
                plainly, and they are what the owner is actually looking for. */}
            {unassignedAmount != null && unassignedAmount > 0.01 && (
              <span style={{ fontWeight: 500, opacity: 0.9, width: '100%' }}>
                {t('bank.toeTeWijzen', { applied: eur.format(s.appliedAmount ?? 0), total: eur.format(Math.abs(s.amount)), open: eur.format(unassignedAmount) })}
              </span>
            )}
          </div>

          {/* [BANK-SUM-SUGGEST] The payment is exactly the sum of a few open invoices of this
              counterparty, and nothing is quoted. Say the arithmetic out loud and offer the
              one-tap; each invoice still books through the normal guarded confirm. Shown only
              when the matcher itself found nothing (outcome 'none' — this card's tab). */}
          {s.sumMatch && onConfirmSum && !isIgnoredTab && !isDoneTab && (
            <div style={{
              padding: '10px 12px', borderRadius: R.md, marginBottom: 10,
              background: M3.primaryContainer, fontSize: 12.5, lineHeight: 1.5, color: M3.onPrimaryContainer,
            }}>
              <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>calculate</span>
                {(s.sumMatch.amounts ?? []).some(a => a < 0)
                  ? t('bank.som.kopVerrekend')
                  : t('bank.som.kop', { count: s.sumMatch.invoiceIds.length })}
              </div>
              <div style={{ margin: '4px 0 8px' }}>
                {/* [CREDIT-VERREKEN] Each number with the sign of what it does to the payment. A
                    creditnota joined by " + " would print "1.764,76 + 52,38 = 1.712,38" — an
                    arithmetic that fails in front of the owner on the screen asking them to
                    confirm it. Falls back to the old join when the response carries no amounts. */}
                {s.sumMatch.invoiceNumbers
                  .map((n, i) => ({ n, a: s.sumMatch?.amounts?.[i] ?? 0 }))
                  .filter(x => !!x.n)
                  .map((x, i) => `${i === 0 ? '' : x.a < 0 ? ' − ' : ' + '}${x.n}`)
                  .join('')} = {eur.format(s.sumMatch.total)} {t(s.amount < 0 ? 'bank.som.leverancier' : 'bank.som.klant')}
              </div>
              <button
                onClick={onConfirmSum}
                disabled={processing}
                style={{
                  padding: '9px 14px', borderRadius: R.full, border: 'none',
                  background: processing ? '#dadce0' : M3.primary, color: '#fff',
                  fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: processing ? 'default' : 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>{processing ? 'hourglass_empty' : 'link'}</span>
                {processing ? t('bank.bezig') : t('bank.som.koppel', { count: s.sumMatch.invoiceIds.length })}
              </button>
            </div>
          )}

          {/* [BANK-BATCH-RECONCILE] Honest sum-check of the whole batch, shown before the
              owner starts confirming. Green ONLY when every referenced invoice is in the
              system AND their totals equal the debit to the cent; an amber warning when
              they don't add up; a neutral note when some invoices are still missing. */}
          {showReconcile && batch && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 6,
              padding: '8px 10px', borderRadius: R.md, marginBottom: 10,
              fontSize: 12.5, fontWeight: 500, lineHeight: 1.45,
              background: batch.status === 'ties' ? M3.successContainer : batch.status === 'mismatch' ? '#FEEFC3' : M3.surfaceVariant,
              color: batch.status === 'ties' ? M3.success : batch.status === 'mismatch' ? '#7A4F00' : '#3c4043',
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }} aria-hidden>
                {batch.status === 'ties' ? 'verified' : batch.status === 'mismatch' ? 'error' : 'info'}
              </span>
              <span>
                {batch.status === 'ties'
                  ? (batch.matchedCount >= 2
                      ? t('bank.batch.ties', { amount: eur.format(batch.total), count: batch.slotCount })
                      : t('bank.batch.tiesEen', { amount: eur.format(batch.total) }))
                  : batch.status === 'mismatch'
                    ? (batch.matchedCount >= 2
                        ? t('bank.batch.mismatch', { total: eur.format(batch.total), bank: eur.format(batch.bankAmount), diff: eur.format(Math.abs(batch.diff)) })
                        : t('bank.batch.mismatchEen', { total: eur.format(batch.total), bank: eur.format(batch.bankAmount), diff: eur.format(Math.abs(batch.diff)) }))
                    : t('bank.batch.ontbreekt', { matched: batch.matchedCount, total: batch.slotCount })}
              </span>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {slots.map((sl) => (
              <div
                key={sl.refNum}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  padding: '9px 10px', borderRadius: R.md,
                  border: `1px solid ${sl.isConfirmed ? M3.successContainer : '#E0E0E0'}`,
                  background: sl.isConfirmed ? M3.successContainer : '#fff',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{
                    fontSize: 13, fontWeight: 600, fontFamily: FONT_NUM,
                    color: sl.isConfirmed ? M3.success : M3.onSurface,
                    display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16, flexShrink: 0 }} aria-hidden>
                      {sl.isConfirmed ? 'check_circle' : sl.cand ? 'pending' : 'upload_file'}
                    </span>
                    {sl.refNum}
                  </span>
                  {/* [BANK-BATCH-RECONCILE] Per-invoice amount + open its PDF — so the
                      owner can check each factuur before confirming a batch payment. Only
                      when a real invoice is matched to this number (else "Koppelen"). */}
                  {sl.cand && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, paddingInlineStart: 22, flexWrap: 'wrap' }}>
                      {sl.cand.amount != null && (
                        <span style={{ fontSize: 12, fontWeight: 600, fontFamily: FONT_NUM, color: '#5F6368' }}>
                          {eur.format(Math.abs(sl.cand.amount))}
                        </span>
                      )}
                      <button
                        onClick={() => onOpenFile(sl.cand!.invoiceId)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 3, border: 'none',
                          background: 'none', cursor: 'pointer', fontFamily: FONT,
                          fontSize: 12, fontWeight: 600, color: M3.primary, padding: 0,
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>description</span>
                        {t('bank.bekijkFactuur')}
                      </button>
                    </span>
                  )}
                </div>

                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                {/* [BANK-SLOT-DISMISS] Remove a number that isn't an invoice (a
                    customer number, a postcode the regex mis-picked). View-only:
                    hides this slot for the session; the stored reference and the
                    raw description (under Details) are untouched. Hidden once a
                    slot is confirmed — there's nothing to dismiss then. */}
                {!sl.isConfirmed && !processing && (
                  <button
                    title={t('bank.geenNummerVerbergen')}
                    aria-label={t('bank.geenFactuurVerberg')}
                    onClick={() => setDismissedNumbers((prev) => new Set(prev).add(normRef(sl.refNum)))}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 26, height: 26, borderRadius: R.full, border: '1px solid #E0E0E0',
                      background: '#fff', color: '#9AA0A6', cursor: 'pointer', padding: 0,
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>close</span>
                  </button>
                )}

                {sl.isConfirmed ? (
                  <span style={{ fontSize: 12, fontWeight: 600, color: M3.success, flexShrink: 0 }}>
                    {t('lijst.betaald')}
                  </span>
                ) : sl.cand ? (
                  /* A matching invoice exists in the system → confirm this one. */
                  <button
                    disabled={processing}
                    onClick={() => onConfirm(sl.cand!.invoiceNumber ?? sl.refNum, sl.cand!.invoiceId)}
                    style={{
                      flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '6px 12px', borderRadius: R.full, border: 'none', background: M3.primary,
                      color: '#fff', fontSize: 12.5, fontWeight: 600, fontFamily: FONT,
                      cursor: processing ? 'default' : 'pointer', opacity: processing ? 0.6 : 1,
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>
                      {processing ? 'hourglass_empty' : 'check'}
                    </span>
                    {t('bank.bevestig')}
                  </button>
                ) : (
                  /* No invoice with this number → upload its file (becomes a paid
                     invoice linked to this transaction via the attach path). */
                  <label
                    style={{
                      flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '6px 12px', borderRadius: R.full, border: `1.5px dashed ${M3.primary}`,
                      background: M3.primaryContainer, color: M3.onPrimaryContainer,
                      fontSize: 12.5, fontWeight: 600, fontFamily: FONT,
                      cursor: processing ? 'default' : 'pointer', opacity: processing ? 0.6 : 1,
                    }}
                  >
                    <input
                      type="file"
                      accept=".pdf,image/*"
                      disabled={processing}
                      style={{ display: 'none' }}
                      onChange={(e) => {
                        const files: File[] = e.target.files ? Array.from(e.target.files) : []
                        e.target.value = ''
                        if (files.length) onAttach(files)
                      }}
                    />
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>
                      {processing ? 'hourglass_empty' : 'attach_file'}
                    </span>
                    {t('bank.koppelen')}
                  </label>
                )}
                </div>
              </div>
            ))}
          </div>

          {/* [SLOT-WAAR] De lezing is geen grens.
              Deze lijst is wat WIJ in deze betaling hebben gelezen, en die lezing kan te weinig
              zien: de bank noemt niet altijd elk factuurnummer, en een omschrijving als "Deel twee
              factuur 202604231" noemt er één terwijl er twee betalingen voor lopen. Zonder deze
              regel eindigt het scherm bij ons aantal en zit de eigenaar vast in onze lezing.
              Het verdeelscherm kent die grens niet — daar kiest hij zelf uit álle facturen die deze
              betaling mag raken, met een bedrag per factuur. Dat scherm bestond al; wat ontbrak was
              de zin die zegt dat het er is op het moment dat je het nodig hebt. */}
          <a
            href={`/dashboard/bank/verdelen/${s.transactionId}`}
            style={{
              marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '9px 11px', borderRadius: R.md, border: `1px solid ${M3.outline}`,
              background: '#fff', textDecoration: 'none', color: '#3c4043',
              fontSize: 12.5, lineHeight: 1.45, fontFamily: FONT,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16, flexShrink: 0, marginTop: 1, color: M3.primary }} aria-hidden>call_split</span>
            <span>
              {t('bank.slot.meerFacturen')}
              <span style={{ display: 'block', fontWeight: 600, color: M3.primary, marginTop: 2 }}>
                {t('bank.slot.meerFacturenKnop')}
              </span>
            </span>
          </a>
          </>
          )}

          {/* Bekijk PDF for any candidate, plus the ignore escape hatch (the whole
              transaction is not an invoice after all). */}
          <button
            disabled={processing}
            onClick={() => setAskReason((v) => !v)}
            style={{
              marginTop: 10, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '8px', borderRadius: R.full, border: 'none', background: 'transparent',
              cursor: processing ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 600, color: '#70757a',
              fontFamily: FONT,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>visibility_off</span>
            {t('bank.negeren')}
          </button>
          {askReason && (
            <div style={{
              marginTop: 8, padding: '10px 12px', borderRadius: R.md,
              background: '#F8F9FA', border: '1px solid #EEE', fontFamily: FONT,
            }}>
              <p style={{ fontSize: 12, color: '#5F6368', margin: '0 0 8px', lineHeight: 1.45 }}>
                {t('bank.redenVraag')}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {BANK_IGNORE_REASONS.map((r) => (
                  <button
                    key={r}
                    disabled={processing}
                    title={BANK_IGNORE_REASON_LABELS[r].hint}
                    onClick={() => { setAskReason(false); onIgnore(r) }}
                    style={{
                      border: '1px solid #DADCE0', borderRadius: R.full, background: '#fff',
                      padding: '6px 12px', fontSize: 12.5, fontWeight: 600, color: '#3C4043',
                      cursor: processing ? 'default' : 'pointer', fontFamily: FONT,
                    }}
                  >
                    {BANK_IGNORE_REASON_LABELS[r].label}
                  </button>
                ))}
                <button
                  disabled={processing}
                  onClick={() => { setAskReason(false); onIgnore(null) }}
                  style={{
                    border: 'none', background: 'transparent', padding: '6px 10px',
                    fontSize: 12.5, fontWeight: 600, color: '#70757a',
                    cursor: processing ? 'default' : 'pointer', fontFamily: FONT,
                  }}
                >
                  {t('bank.zonderReden')}
                </button>
              </div>
              {/* [GENEGEERD-TELT] Wat de keuze met het GELD doet, zichtbaar. Dit stond alleen in een
                  title-attribuut: een tooltip die op een telefoon niet bestaat, terwijl drie van de vijf
                  knoppen het bedrag ook uit de kosten en de btw halen. De namen komen uit de regel zelf
                  (ignoreReasonGroups), zodat de zin niet kan afwijken van wat er werkelijk gebeurt. */}
              <p style={{ fontSize: 11.5, color: '#5F6368', margin: '8px 0 0', lineHeight: 1.45 }}>
                {t('bank.redenGevolg', {
                  uit: ignoreReasonGroups().excluded.join(', '),
                  in: ignoreReasonGroups().kept.join(' en '),
                })}
              </p>
            </div>
          )}

        </div>
      )}

      {/* Match body — single-invoice transactions (and the ignored tab). */}
      {!wasMulti && s.outcome === 'none' && (
        <div style={{ marginTop: 12 }}>
          {isIgnoredTab ? (
            /* [BANK-IGNORE] Genegeerd tab — show a restore action, nothing else. */
            <>
              <div style={{ fontSize: 12.5, color: '#70757a', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>visibility_off</span>
                {t('bank.genegeerdWeg')}
              </div>
              {/* [BANK-IGNORE-REDEN] Waarom deze regel hier staat. Neutraal grijs: dit is een
                  aantekening, geen waarschuwing. Ontbreekt hij — een rij van vóór deze kolom, of de
                  vraag overgeslagen — dan staat er niets, want liever geen label dan een verzonnen
                  label. Dit is het hele punt van de kolom: drie maanden later, bij de
                  kwartaalafsluiting, stond hier een bedrag zonder één woord waarom. */}
              {bankIgnoreReasonLabel(s.ignoreReason) && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 6,
                  padding: '3px 9px', borderRadius: 8, background: '#f1f3f4', border: '1px solid #e0e3e6',
                }}>
                  <span style={{ fontSize: 12, color: '#5f6368', fontWeight: 600 }}>
                    {bankIgnoreReasonLabel(s.ignoreReason)}
                  </span>
                </div>
              )}
              <button
                disabled={processing}
                onClick={onRestore}
                style={{
                  marginTop: 10, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '9px', borderRadius: R.full, border: `1.5px solid #E0E0E0`, background: '#fff',
                  cursor: processing ? 'default' : 'pointer', fontSize: 13.5, fontWeight: 600, color: M3.primary,
                  fontFamily: FONT, opacity: processing ? 0.6 : 1,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>
                  {processing ? 'hourglass_empty' : 'undo'}
                </span>
                {processing ? t('bank.bezig') : t('bank.terugzetten')}
              </button>
            </>
          ) : (
            <>
              {s.explainedByQueued ? (
                /* [CIRKEL] The invoice is already in the app, waiting to be verified — the one
                   answer that stops the owner from uploading it a second time. */
                <div style={{ borderRadius: 10, background: '#E8F0FE', padding: '10px 12px' }}>
                  <div style={{ fontSize: 12.5, color: '#174EA6', display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.5 }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>inventory</span>
                    {s.explainedByQueued.invoiceNumber
                      ? t('bank.inWachtrij', { number: s.explainedByQueued.invoiceNumber })
                      : t('bank.inWachtrijZonderNummer')}
                  </div>
                  <Link
                    href={`/dashboard/incoming?focus=${encodeURIComponent(s.explainedByQueued.invoiceId)}`}
                    style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: M3.primary, textDecoration: 'none' }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 17 }} aria-hidden>task_alt</span>
                    {t('bank.verifieerEerst')}
                  </Link>
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: '#70757a', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>help</span>
                  {t('bank.fout.geenFactuur')}
                </div>
              )}
              {/* [WAAROM-WACHT-BANK] Waarom deze regel zichzelf niet koppelde.
              
                  Het tabblad "Geen factuur" had één alinea voor álle regels, en die was over elke
                  regel waar en over geen enkele nuttig. De redenen eronder vragen tegengestelde
                  handelingen: een factuur TOEVOEGEN (de betaling noemt een nummer dat we niet
                  kennen), er één KIEZEN (meerdere met hetzelfde bedrag), wachten op een deelbetaling,
                  of de regel één keer een categorie geven.
              
                  Niet naast de somsuggestie: die IS al een uitleg mét een knop eronder, en twee
                  uitleggen van één regel is hoe een rustig scherm een zeurend scherm wordt. Niet op
                  het Genegeerd- of Gekoppeld-tabblad: daar is de vraag al beantwoord. En niets
                  wanneer de server niets kon zeggen — een verzonnen uitleg op een geldscherm is
                  erger dan de leegte die de eigenaar al had. */}
              {/* [STORNO] The credit names the payment it undoes, and the one tap that states the fact. */}
              {!isIgnoredTab && !isDoneTab && s.storno && onStorno && (
                <div style={{ padding: '9px 11px', borderRadius: R.md, marginBottom: 10, background: '#FFF8E1', border: '1px solid #FFE082', color: '#8D6E00', fontSize: 12.5, lineHeight: 1.5, textAlign: 'start' }}>
                  <div>{t('bank.storno.uitleg', { date: fmtInvoiceDate(s.storno.originDate), number: s.storno.invoiceNumber ?? '—' })}</div>
                  <button
                    type="button"
                    onClick={onStorno}
                    disabled={processing}
                    style={{ marginTop: 8, padding: '8px 12px', borderRadius: R.full, border: 'none', background: M3.primary, color: '#fff', fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: processing ? 'default' : 'pointer' }}
                  >
                    {t('bank.storno.knop')}
                  </button>
                </div>
              )}
              {(() => {
                if (isIgnoredTab || isDoneTab || s.sumMatch) return null
                const uitleg = explainWaiting(s.waitReason ?? null, {}, taal)
                if (!uitleg) return null
                return (
                  <div
                    dir={uitleg.dir}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: 6,
                      padding: '9px 11px', borderRadius: R.md, marginBottom: 10,
                      background: M3.surfaceVariant, color: '#3c4043',
                      fontSize: 12.5, lineHeight: 1.5, textAlign: 'start',
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }} aria-hidden>help</span>
                    <span>{uitleg.text}</span>
                  </div>
                )
              })()}

              {/* [BANK-ATTACH] Attach the document(s) for this payment. Shown on
                  BOTH debit (expense → inkoopfactuur) and credit (income/refund →
                  verkoopfactuur) — income also has documents worth linking (a
                  supplier refund, a B2B sale). One transaction can pay SEVERAL
                  invoices, so the file picker accepts MULTIPLE files at once. */}
              <label
                style={{
                  marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '9px', borderRadius: R.full, border: `1.5px dashed ${M3.primary}`,
                  background: M3.primaryContainer, cursor: processing ? 'default' : 'pointer',
                  fontSize: 13.5, fontWeight: 600, color: M3.onPrimaryContainer, opacity: processing ? 0.6 : 1,
                }}
              >
                <input
                  type="file"
                  accept=".pdf,image/*"
                  multiple
                  disabled={processing}
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const files: File[] = e.target.files ? Array.from(e.target.files) : []
                    e.target.value = ''
                    if (files.length) onAttach(files)
                  }}
                />
                <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>
                  {processing ? 'hourglass_empty' : 'attach_file'}
                </span>
                {processing
                  ? t('bank.verwerken')
                  : slotNumbers.length > 1 ? t('bank.facturenKoppelen', { count: slotNumbers.length }) : t('bank.factuurKoppelen')}
              </label>
              {/* [REGEL-FACTUUR] The third door beside "attach a file" and "ignore": say what it
                  was. For the supplier who never sends a bill, the receipt that went through the
                  wash, the cash sale paid by transfer. The money rule is the server's. */}
              {onCreateFromLine && !isIgnoredTab && (
                <button
                  type="button"
                  onClick={onCreateFromLine}
                  disabled={processing}
                  style={{ marginTop: 8, width: '100%', padding: '9px', borderRadius: R.full, border: '1px solid #DADCE0', background: '#fff', color: '#3C4043', fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: processing ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 17 }} aria-hidden>edit_note</span>
                  {t('bank.lf.knop')}
                </button>
              )}
              {/* [BETAALPLAN] De derde uitweg, die er niet was.
                  Er waren er twee: koppel een BESTAND, of negeer de regel. Beide gaan uit van de
                  aanname dat één betaling bij één factuur hoort. Een groothandel schrijft één bedrag
                  af voor een week leveringen; een klant maakt één som over voor vier facturen en
                  houdt op de laatste twaalf euro in; een leverancier trekt eerst een creditnota van
                  de partij af. Niets daarvan paste, dus werd het opgelost door iets anders in te
                  vullen dan wat er gebeurde — of door de regel te negeren, waarna hij in geen enkel
                  cijfer meer voorkomt.

                  Dit scherm laat de eigenaar de facturen die er AL staan zelf aanwijzen, met een
                  bedrag per factuur. Bewust een aparte pagina: er is ruimte nodig voor een lijst,
                  een bedragveld per regel en één getal dat bovenaan meeloopt — "nog te verdelen" —
                  en dat past niet in een kaartje van 300 pixels. */}
              <a
                href={`/dashboard/bank/verdelen/${s.transactionId}`}
                style={{
                  marginTop: 8, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '9px', borderRadius: R.full, border: `1px solid ${M3.outline}`,
                  background: '#ffffff', textDecoration: 'none',
                  fontSize: 13.5, fontWeight: 600, color: M3.primary, fontFamily: FONT, boxSizing: 'border-box',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>call_split</span>
                {t('bank.verdelen')}
              </a>

              {/* [BANK-IGNORE] Hide a transaction that needs no invoice (rent, a
                  loan instalment, a personal transfer). Goes to Genegeerd. */}
              <button
                disabled={processing}
                onClick={() => setAskReason((v) => !v)}
                style={{
                  marginTop: 8, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '8px', borderRadius: R.full, border: 'none', background: 'transparent',
                  cursor: processing ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 600, color: '#70757a',
                  fontFamily: FONT,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden>visibility_off</span>
                {t('bank.negeren')}
              </button>
            {askReason && (
              <div style={{
                marginTop: 8, padding: '10px 12px', borderRadius: R.md,
                background: '#F8F9FA', border: '1px solid #EEE', fontFamily: FONT,
              }}>
                <p style={{ fontSize: 12, color: '#5F6368', margin: '0 0 8px', lineHeight: 1.45 }}>
                  {t('bank.redenVraag')}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {BANK_IGNORE_REASONS.map((r) => (
                    <button
                      key={r}
                      disabled={processing}
                      title={BANK_IGNORE_REASON_LABELS[r].hint}
                      onClick={() => { setAskReason(false); onIgnore(r) }}
                      style={{
                        border: '1px solid #DADCE0', borderRadius: R.full, background: '#fff',
                        padding: '6px 12px', fontSize: 12.5, fontWeight: 600, color: '#3C4043',
                        cursor: processing ? 'default' : 'pointer', fontFamily: FONT,
                      }}
                    >
                      {BANK_IGNORE_REASON_LABELS[r].label}
                    </button>
                  ))}
                  <button
                    disabled={processing}
                    onClick={() => { setAskReason(false); onIgnore(null) }}
                    style={{
                      border: 'none', background: 'transparent', padding: '6px 10px',
                      fontSize: 12.5, fontWeight: 600, color: '#70757a',
                      cursor: processing ? 'default' : 'pointer', fontFamily: FONT,
                    }}
                  >
                    {t('bank.zonderReden')}
                  </button>
                </div>
                {/* [GENEGEERD-TELT] Wat de keuze met het GELD doet, zichtbaar. Dit stond alleen in een
                    title-attribuut: een tooltip die op een telefoon niet bestaat, terwijl drie van de vijf
                    knoppen het bedrag ook uit de kosten en de btw halen. De namen komen uit de regel zelf
                    (ignoreReasonGroups), zodat de zin niet kan afwijken van wat er werkelijk gebeurt. */}
                <p style={{ fontSize: 11.5, color: '#5F6368', margin: '8px 0 0', lineHeight: 1.45 }}>
                  {t('bank.redenGevolg', {
                    uit: ignoreReasonGroups().excluded.join(', '),
                    in: ignoreReasonGroups().kept.join(' en '),
                  })}
                </p>
              </div>
            )}
            </>
          )}
        </div>
      )}

      {/* [NIET-DEZE-FACTUUR] The way back, where the suggestion was. */}
      {!wasMulti && onUndoReject && (
        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#5F6368' }}>{t('bank.nietDeze.weg')}</span>
          <button
            onClick={onUndoReject}
            style={{
              border: 'none', background: 'none', cursor: 'pointer', fontFamily: FONT,
              fontSize: 12, fontWeight: 600, color: M3.primary, padding: '2px 4px',
            }}
          >
            {t('bank.nietDeze.terug')}
          </button>
        </div>
      )}

      {/* [AL-GEBOEKT] Not shown once the payment names an invoice that is already settled — see
          AlGeboektKaart below and bank-quoted-invoice.ts. Two sessions answered this same question;
          this is the answer that works on the real rows. The other one ([AFSCHRIFT-NOEMT]) read the
          reference with parseReferenceNumbers, which splits on COMMAS, so `USTD//2919045/` became a
          single token matching no invoice. It was dropped in the merge rather than kept beside it. */}
      {!wasMulti && !s.quotedSettled && s.outcome === 'auto' && s.best && (
        <CandidateRow cand={s.best} selected emphasis onOpenFile={onOpenFile} onCorrect={onCorrect} onReject={onReject} />
      )}

      {/* [AL-GEBOEKT] Deze betaling noemt een factuur die al is afgeboekt. Dan is er niets te
          kiezen, en een kiezer tónen is hier het gevaar: elke kandidaat eronder is een ANDERE,
          nog openstaande factuur, en bevestigen zou die als betaald wegzetten met geld dat er
          niet voor was. De kiezer verdwijnt dus; deze zin komt ervoor in de plaats. */}
      {/* [SOM-KLOPT] Meer dan één genoemde factuur → de kaart die OPTELT. De enkelvoudige kaart
          blijft voor het geval dat er maar één is; hij zegt daar precies hetzelfde en korter. */}
      {!wasMulti && s.quotedSet && s.quotedSet.settled.length + s.quotedSet.open.length > 1 && (
        <SomKloptKaart set={s.quotedSet} betaling={s.amount} onOpenFile={onOpenFile} />
      )}
      {!wasMulti && s.quotedSettled && !(s.quotedSet && s.quotedSet.settled.length + s.quotedSet.open.length > 1) && (
        <AlGeboektKaart q={s.quotedSettled} onOpenFile={onOpenFile} />
      )}

      {!wasMulti && !s.quotedSettled && !s.quotedSet?.fullySettled && s.outcome === 'choice' && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* [BANK-CHOICE-CLARITY] Say WHY we're asking. The bank payment had no single
              invoice number to match on (e.g. a recurring incasso), so several invoices
              fit. Comparing bedrag + datum is how the owner picks the right one — the old
              bare "Factuur VHF…" list gave nothing to compare and read as a guess. */}
          {/* [WAAROM-DEZE] "Meerdere facturen passen bij deze betaling" is een bewering, en hij is
              onwaar zodra geen enkele kandidaat op BEDRAG matcht — dan staan er facturen van
              dezelfde leverancier, meer niet. Dat verschil is precies wat een ondernemer met een
              schermafbeelding kwam melden. */}
          <div style={{ fontSize: 12, color: '#5F6368', marginBottom: 2, lineHeight: 1.45 }}>
            {s.candidates.some((c) => Array.isArray(c.signals) && c.signals.includes('amount'))
              ? <>{t('bank.vergelijk')} <strong>{t('bank.vergelijkBedrag')}</strong> {t('bank.vergelijkEn')} <strong>{t('bank.vergelijkDatum')}</strong> {t('bank.vergelijkKies')}</>
              : t('bank.vergelijkGeenBedrag')}
          </div>
          {s.candidates.map((c) => {
            const isSel = selectedInvoiceId === c.invoiceId
            return (
            <div
              key={c.invoiceId}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(c.invoiceId)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(c.invoiceId) } }}
              style={{
                textAlign: 'start', border: `1.5px solid ${isSel ? M3.primary : '#E0E0E0'}`,
                background: isSel ? M3.primaryContainer : '#fff',
                borderRadius: R.md, padding: '8px 10px', cursor: 'pointer', fontFamily: FONT,
              }}
            >
              <CandidateRow cand={c} selected={isSel} inline onOpenFile={onOpenFile} onReject={onReject} />
            </div>
            )
          })}
        </div>
      )}

      {/* [BANK-PARTIAL] What this confirm will ACTUALLY do, stated before the tap.
          [PARTIAL-PAY] A partial-paid state now exists (invoices.amount_paid), and
          /api/bank/confirm books a single-invoice payment through apply_bank_payment, which
          applies LEAST(payment, remaining) and flips to 'paid' only when fully covered. So the
          comparison is against the REMAINING balance, never the full total — otherwise the very
          instalment that COMPLETES a half-paid invoice got warned about as a "deelbetaling".
          Three honest outcomes: pays part of what's left, pays exactly what's left (no warning,
          just context when something was already paid), or exceeds it (the excess is NOT booked). */}
      {!wasMulti && s.outcome !== 'none' && selectedCand && selectedCand.amount != null && (() => {
        const txAbs = Math.abs(s.amount)
        const invAbs = Math.abs(selectedCand.amount ?? 0)
        // Fall back to the full total for candidates built outside matchTransactions
        // (batch reconcile omits these fields) — same behaviour as before for those.
        const paidAlready = Math.max(0, selectedCand.amountPaid ?? 0)
        const remaining = selectedCand.remaining ?? invAbs
        const hasPartial = paidAlready > 0.005
        const under = remaining - txAbs > 0.01
        const over = txAbs - remaining > 0.01
        // Exactly settles a fully-open invoice → nothing to say.
        if (!under && !over && !hasPartial) return null
        // Neutral (blue) context when the payment fits what's left; amber only for a real surprise.
        const neutral = !over
        return (
          <div style={{
            marginTop: 12, padding: '10px 12px', borderRadius: R.md,
            background: neutral ? M3.primaryContainer : '#FEEFC3',
            color: neutral ? M3.onPrimaryContainer : '#7A4F00',
            fontSize: 12.5, fontWeight: 500, lineHeight: 1.45, display: 'flex', gap: 6, alignItems: 'flex-start',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }} aria-hidden>
              {neutral ? 'info' : 'warning'}
            </span>
            <span>
              {over ? (
                <>{t('bank.maximaal')} <strong>{eur.format(remaining)}</strong> {t('bank.maximaalGeboekt')}{' '}
                  <strong>{eur.format(txAbs - remaining)}</strong> {t('bank.blijftOver')}</>
              ) : under ? (
                <>{t('bank.deel.geboekt', { amount: eur.format(txAbs) })}{' '}
                  {hasPartial && <>{t('bank.deel.alBetaald', { amount: eur.format(paidAlready) })} </>}
                  {t('bank.deel.daarnaOpen', { amount: eur.format(remaining - txAbs) })}</>
              ) : (
                <>{t('bank.deel.voltooid', { paid: eur.format(paidAlready), remaining: eur.format(remaining) })}</>
              )}
            </span>
          </div>
        )
      })()}

      {/* Confirm.
          [AL-GEBOEKT-KLEMT] While the payment names an invoice that is already booked, this is not a
          one-tap confirm. The owner may still choose a candidate deliberately — the button comes back
          the moment they select one — but nothing is pre-selected, so the tap can no longer happen on
          the way past. */}
      {!wasMulti && s.outcome !== 'none' && (
        <button
          disabled={!selectedInvoiceId || processing}
          onClick={() => onConfirm(selectedCand?.invoiceNumber ?? null)}
          style={{
            marginTop: 12, width: '100%', padding: '11px', borderRadius: R.full, border: 'none',
            cursor: !selectedInvoiceId || processing ? 'default' : 'pointer',
            background: !selectedInvoiceId ? M3.surfaceVariant : M3.primary,
            color: !selectedInvoiceId ? '#70757a' : '#fff', fontSize: 14, fontWeight: 600, fontFamily: FONT,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          {processing
            ? <span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>hourglass_empty</span>
            : <><span className="material-symbols-outlined" style={{ fontSize: 18 }} aria-hidden>check</span> {t('bank.bevestigBetaling')}</>}
        </button>
      )}
      {bijlagen}
    </div>
  )
}

// [BANK-CHOICE-CLARITY] Short, human date for a candidate invoice ("12 jun. 2026").
// The differentiator when several candidates share one amount (monthly rent, etc.).
const NL_MONTHS = ['jan.', 'feb.', 'mrt.', 'apr.', 'mei', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.']
function fmtInvoiceDate(iso: string | null): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return ''
  return `${Number(m[3])} ${NL_MONTHS[Number(m[2]) - 1]} ${m[1]}`
}
// [BANK-CHOICE-CLARITY] Plain-language reason a candidate is offered, from the engine's own
// match signals — so "why is this here?" is answered instead of a bare invoice number.
// [TAAL] Keys, not sentences: the module is shared, the language belongs to the caller's `t`.
// [WAAROM-DEZE] Alle TIEN signalen, en dat aantal is het punt. Deze tabel had er vier, dus een
// kandidaat die op het REKENINGNUMMER van de leverancier was gevonden — het sterkste bewijs dat er
// is na een factuurnummer — toonde alleen "datum dichtbij", de zwakste reden in de rij. Zo ontstaat
// precies de indruk die een ondernemer met een schermafbeelding kwam melden: dat het scherm maar
// wat aanbiedt. De reden was er wel, hij werd berekend, en hij kwam er niet uit.
//
// Een nieuw signaal in bank-matching.ts zonder regel hier valt terug op stilte; de poort
// [WAAROM-DEZE] in lifecycle-gates houdt de twee lijsten daarom tegen elkaar aan.
const WHY_KEY = {
  amount: 'bank.why.amount',
  counterpart: 'bank.why.counterpart',
  date: 'bank.why.date',
  reference: 'bank.why.reference',
  iban: 'bank.why.iban',
  supplier_iban: 'bank.why.supplierIban',
  memory: 'bank.why.memory',
  prepared: 'bank.why.prepared',
  near_amount: 'bank.why.nearAmount',
  partial_amount: 'bank.why.partialAmount',
} as const

// [AL-GEBOEKT] De kaart die in de plaats komt van de kiezer.
//
// Waarom dit een KAART is en geen chip onder de kandidaten: het is geen extra hint bij een keuze,
// het is het bericht dat de keuze niet bestaat. Onder de oude kiezer stonden alleen andere,
// openstaande facturen van dezelfde leverancier — en een tik daarop boekt deze betaling op een
// rekening die niemand betaald heeft. Zo'n knop hoort er niet naast te staan.
//
// [TAAL] Alle tekst uit messages.ts; dit component draagt geen eigen taal.
// [SOM-KLOPT] Eén betaling, alle facturen die zij noemt, en de optelsom eronder.
//
// De aanleiding stond op één schermafbeelding: € 466,30 aan Al-Malika Bakkerij, omschrijving
// "2601695, 2601826, 2601291", en de app zei "Geen factuur gevonden voor deze transactie", bood
// drie facturen aan om te koppelen, en zette daaronder een kaart over ÉÉN van de drie met de
// mededeling dat het bedrag niet overeenkwam. Die drie facturen zijn 162,19 + 148,68 + 155,43 =
// 466,30 en stonden alle drie al betaald in de administratie.
//
// Deze kaart doet dus wat een mens met de bon in de hand doet: hij telt op, en zegt wat eruit komt.
// Hij BOEKT niets — dat is [ZELF-EERST] — en hij verzwijgt niets: klopt de som niet, dan staat dat
// er net zo duidelijk als wanneer hij wel klopt, want "bijna" is op een geldscherm geen antwoord.
function SomKloptKaart({
  set, betaling, onOpenFile,
}: {
  set: NonNullable<Suggestion['quotedSet']>
  betaling: number | null
  onOpenFile?: (invoiceId: string) => void
}) {
  const t = translator(useLocale())
  const klopt = set.coversPayment
  return (
    <div style={{
      marginTop: 10, padding: '12px 14px', borderRadius: 12,
      background: '#e8f0fe', border: '1px solid #c6dafc',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#174ea6', marginBottom: 6 }}>
        {/* De kop mag niet "al afgeboekt" zeggen zolang er nog een genoemde factuur openstaat —
            dan is het de helft van de waarheid, en juist de helft die niets vraagt. */}
        {set.fullySettled ? t('bank.somKlopt.titel') : t('bank.somKlopt.titelDeels')}
      </div>
      {/* De regels zelf. Elke factuur met haar bedrag, want de optelsom eronder moet na te rekenen
          zijn — een totaal zonder de posten erboven is een bewering, geen bewijs. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 7 }}>
        {/* [CREDIT-TEKEN] Eén regel per genoemd factuurnummer, en dat is de optelsom zelf: een tweede
            rij met hetzelfde nummer (dubbele import, of de gearchiveerde voorganger van een
            gecorrigeerde factuur) telt in het totaal niet mee, dus hoort hij hier ook niet te staan.
            Anders drukt de kaart −136,00 twee keer af boven een totaal dat het één keer gebruikte,
            en is de som met de hand niet na te rekenen. De kiezer eronder toont wél elke rij. */}
        {[...set.settled, ...set.open].filter((inv) => inv.countedInTotal !== false).map((inv) => (
          <div key={inv.invoiceId} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, color: '#202124' }}>
            <button
              type="button"
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); onOpenFile?.(inv.invoiceId) }}
              disabled={!onOpenFile}
              style={{
                background: 'none', border: 'none', padding: 0, textAlign: 'start',
                cursor: onOpenFile ? 'pointer' : 'default', color: onOpenFile ? '#1a73e8' : '#202124',
                fontSize: 13, fontFamily: 'inherit', minWidth: 0, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {t('bank.factuurNummer', { number: inv.invoiceNumber })}
              {inv.clientName && <span style={{ color: '#5f6368' }}> · {inv.clientName}</span>}
            </button>
            {inv.amount != null && (
              // [CREDIT-TEKEN] Het bedrag MET het teken waarmee het is opgeteld. Dit stond hier als
              // Math.abs, en daarmee las een creditnota van € 136,00 op het scherm als een rekening
              // van € 136,00 — een document dat geld TERUGGEEFT, afgedrukt als iets dat je betaalt.
              //
              // Niet `inv.amount` zelf, maar het teken dat de som gebruikte: een creditnota die in de
              // administratie positief staat telt tóch negatief mee (zie creditSign), en het bedrag
              // hierboven afdrukken naast een totaal dat het andersom gebruikte maakt de optelsom
              // oncontroleerbaar — precies wat deze kaart de ondernemer moet laten doen.
              <span style={{ fontFamily: FONT_NUM, fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0, color: inv.isCredit ? '#137333' : undefined }}>
                {eur.format(inv.isCredit ? -Math.abs(inv.amount) : Math.abs(inv.amount))}
              </span>
            )}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: '#3c4043', lineHeight: 1.5 }}>
        {set.total == null
          // [NO-SILENT-EMPTY] Een onbekende som is niet nul, en de kaart mag dan niets beweren over
          // kloppen. Hier stond één zin die over iets anders ging — "de andere facturen van deze
          // leverancier horen bij andere betalingen" — zodat de ondernemer nooit te horen kreeg
          // DÁT er niet opgeteld kon worden, laat staan waarom. Nu zegt de reden zichzelf.
          ? t('bank.somKlopt.somOnleesbaar')
          : klopt
            ? t('bank.somKlopt.telt', { som: eur.format(Math.abs(set.total)) })
            : t('bank.somKlopt.teltNiet', {
                som: eur.format(Math.abs(set.total)),
                betaling: betaling == null ? '—' : eur.format(Math.abs(betaling)),
              })}
      </div>
      {/* [SOM-KLOPT] Genoemd, aanwezig, nog OPEN. Een andere zin dan "ontbreekt": deze factuur
          staat er wél, en de kiezer eronder is precies de juiste knop ervoor. Zeggen dat hij
          ontbreekt zou de ondernemer naar de schoenendoos sturen voor papier dat hij al heeft. */}
      {set.open.length > 0 && (
        <div style={{ fontSize: 12, color: '#3c4043', lineHeight: 1.5, marginTop: 5 }}>
          {t('bank.somKlopt.nogOpen', { nummers: set.open.map((o) => o.invoiceNumber).join(', ') })}
        </div>
      )}
      {set.unknownNumbers.length > 0 && (
        <div style={{ fontSize: 12, color: '#3c4043', lineHeight: 1.5, marginTop: 5 }}>
          {t('bank.somKlopt.ontbreekt', { nummers: set.unknownNumbers.join(', ') })}
        </div>
      )}
    </div>
  )
}

function AlGeboektKaart({
  q, onOpenFile,
}: {
  q: NonNullable<Suggestion['quotedSettled']>
  onOpenFile?: (invoiceId: string) => void
}) {
  const t = translator(useLocale())
  const uitleg = q.lockedByAccountant
    ? t('bank.alGeboekt.verwerkt')
    : q.amountAgrees
      ? t('bank.alGeboekt.zelfdeBedrag')
      : t('bank.alGeboekt.anderBedrag')
  return (
    <div style={{
      marginTop: 10, padding: '12px 14px', borderRadius: 12,
      background: '#e8f0fe', border: '1px solid #c6dafc',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#174ea6', marginBottom: 4 }}>
        {t('bank.alGeboekt.titel')}
      </div>
      <div style={{ fontSize: 13, color: '#202124', marginBottom: 6 }}>
        {t('bank.alGeboekt.regel', { nummer: q.invoiceNumber, partij: q.clientName ?? '' })}
        {q.amount != null && ` · ${eur.format(Math.abs(q.amount))}`}
      </div>
      <div style={{ fontSize: 12, color: '#3c4043', lineHeight: 1.5, marginBottom: 4 }}>{uitleg}</div>
      <div style={{ fontSize: 12, color: '#5f6368', lineHeight: 1.5 }}>
        {t('bank.alGeboekt.waaromGeenKeuze')}
      </div>
      {onOpenFile && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenFile(q.invoiceId) }}
          style={{
            marginTop: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            color: '#1a73e8', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
          }}
        >
          {t('bank.alGeboekt.bekijk')}
        </button>
      )}
    </div>
  )
}

function CandidateRow({ cand, selected, emphasis, inline, onOpenFile, onCorrect, onReject }: { cand: Candidate; selected?: boolean; emphasis?: boolean; inline?: boolean; onOpenFile?: (invoiceId: string) => void; onCorrect?: (invoiceId: string) => void; onReject?: (invoiceId: string) => void }) {
  const t = translator(useLocale())
  // [BANK-CHOICE-CLARITY] In the choice list, the engine's amount signal means this
  // invoice's total equals the bank amount — the strongest hint, so highlight it.
  const amountMatches = Array.isArray(cand.signals) && cand.signals.includes('amount')
  const why = Array.isArray(cand.signals)
    ? cand.signals
        .map((s) => WHY_KEY[s as keyof typeof WHY_KEY])
        .filter((k): k is (typeof WHY_KEY)[keyof typeof WHY_KEY] => Boolean(k))
        .map((k) => t(k))
    : []
  return (
    <div style={{ marginTop: emphasis ? 12 : 0, padding: emphasis ? '10px 12px' : 0, borderRadius: R.md, background: emphasis ? M3.successContainer : 'transparent' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: emphasis ? M3.success : M3.onSurface, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {emphasis && <span className="material-symbols-outlined" style={{ fontSize: 15, verticalAlign: 'middle', marginInlineEnd: 4 }} aria-hidden>task_alt</span>}
          {t('bank.factuurNummer', { number: cand.invoiceNumber ?? '—' })}
          {/* [CIRKEL] The supplier, right beside the number — the fact a person actually
              recognizes when choosing between same-looking candidates. */}
          {cand.clientName && <span style={{ fontWeight: 400, color: emphasis ? M3.success : '#5F6368' }}> · {cand.clientName}</span>}
        </span>
        {/* [BANK-CHOICE-CLARITY] The amount, on the right — the first thing to compare
            when picking between candidates. Green + check when it equals the debit. */}
        {inline && cand.amount != null && (
          <span style={{
            fontFamily: FONT_NUM, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
            color: amountMatches ? M3.success : M3.onSurface,
            display: 'inline-flex', alignItems: 'center', gap: 3,
          }}>
            {amountMatches && <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>check</span>}
            {eur.format(Math.abs(cand.amount))}
          </span>
        )}
      </div>
      {/* [BANK-CHOICE-CLARITY] Second line for the choice list: the invoice date (the
          differentiator for same-amount candidates), why it matched, and its PDF. */}
      {inline && (
        <div style={{ marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5, color: '#5F6368' }}>
          {fmtInvoiceDate(cand.invoiceDate) && <span>{fmtInvoiceDate(cand.invoiceDate)}</span>}
          {why.length > 0 && <span style={{ color: amountMatches ? M3.success : '#5F6368', fontWeight: amountMatches ? 600 : 400 }}>· {why.join(' · ')}</span>}
          {onOpenFile && (
            <button
              onClick={(e) => { e.stopPropagation(); onOpenFile(cand.invoiceId) }}
              // [A11Y] The row wrapper is a role=button that selects on Enter/Space; stop
              // the key event here so opening the PDF doesn't ALSO select the candidate.
              onKeyDown={(e) => e.stopPropagation()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3, marginInlineStart: 'auto',
                border: 'none', background: 'none', cursor: 'pointer', fontFamily: FONT,
                fontSize: 12, fontWeight: 600, color: M3.primary, padding: '2px 4px',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>description</span>
              {t('bank.bekijkFactuur')}
            </button>
          )}
          {/* [NIET-DEZE-FACTUUR] The button that did not exist. The card offered one invoice and
              one confirm, so a wrong suggestion could only be accepted or left sitting — and left
              sitting means the same wrong pair is offered again on every visit. Nothing is booked
              by this; the suggestion goes, and it comes back with one tap. */}
          {onReject && (
            <button
              onClick={(e) => { e.stopPropagation(); onReject(cand.invoiceId) }}
              onKeyDown={(e) => e.stopPropagation()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                border: 'none', background: 'none', cursor: 'pointer', fontFamily: FONT,
                fontSize: 12, fontWeight: 600, color: '#5F6368', padding: '2px 4px',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>block</span>
              {t('bank.nietDeze')}
            </button>
          )}
          {/* [FULL-CORRECTION] The moment a wrong figure is most likely to be SEEN: the owner is
              looking at the payment with the paper next to it. Same editor as the pay screen, same
              route, same guards — see InvoiceCorrectionModal. */}
          {onCorrect && (
            <button
              onClick={(e) => { e.stopPropagation(); onCorrect(cand.invoiceId) }}
              onKeyDown={(e) => e.stopPropagation()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                marginInlineStart: onOpenFile ? 0 : 'auto',
                border: 'none', background: 'none', cursor: 'pointer', fontFamily: FONT,
                fontSize: 12, fontWeight: 600, color: M3.primary, padding: '2px 4px',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>edit</span>
              {t('bank.gegevensCorrigeren')}
            </button>
          )}
        </div>
      )}
      {!inline && (
        <div style={{ marginTop: 4, display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* [BANK-PROOF-LINE] Instead of an algorithmic "97%" + cryptic Kenmerk/Bedrag
              chips, state in plain Dutch WHY this is a safe confirm: the amount and the
              invoice number shown at the top of the card both come straight from the
              owner's own bank statement. The owner verifies against a trusted source
              (their bank), not the app's confidence score. Only on a strong (emphasis)
              match; the choice list shows nothing extra. */}
          {emphasis && (
            <span style={{ fontSize: 11.5, color: M3.success, fontWeight: 500 }}>
              {/* [BANK-PSP-MATCH] Honest proof line: only claim the factuurnummer is in the
                  statement when the reference signal actually fired. An amount+counterpart
                  match (a PSP/order payment) has NO invoice number in the statement, so we
                  say only that the amount matches — never invent a reference that isn't there. */}
              {Array.isArray(cand.signals) && cand.signals.includes('reference')
                ? t('bank.proof.metNummer')
                : t('bank.proof.bedrag')}
            </span>
          )}
          {/* [BANK-INVOICE-FILE] Open the actual invoice PDF before confirming. */}
          {onOpenFile && (
            <button
              onClick={() => onOpenFile(cand.invoiceId)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, marginInlineStart: 'auto',
                border: 'none', background: 'none', cursor: 'pointer', fontFamily: FONT,
                fontSize: 12, fontWeight: 600, color: M3.primary, padding: '2px 4px',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 15 }} aria-hidden>description</span>
              {t('bank.bekijkFactuur')}
            </button>
          )}
          {/* [NIET-DEZE-FACTUUR] The button that did not exist. The card offered one invoice and
              one confirm, so a wrong suggestion could only be accepted or left sitting — and left
              sitting means the same wrong pair is offered again on every visit. Nothing is booked
              by this; the suggestion goes, and it comes back with one tap. */}
          {onReject && (
            <button
              onClick={(e) => { e.stopPropagation(); onReject(cand.invoiceId) }}
              onKeyDown={(e) => e.stopPropagation()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 3,
                border: 'none', background: 'none', cursor: 'pointer', fontFamily: FONT,
                fontSize: 12, fontWeight: 600, color: '#5F6368', padding: '2px 4px',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden>block</span>
              {t('bank.nietDeze')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}