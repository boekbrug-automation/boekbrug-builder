// src/modules/accountant/accountant.types.ts
// [BOEK-028] Accountant Portal — shared types — May 2026
// Single source of truth for all accountant module types.
// Do not import from here in ZZP modules.

// ─────────────────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────────────────

/**
 * [READINESS] Honest, fact-only readiness of a client for a quarter. Every field
 * is something the system can PROVE from stored data — never a verdict/guess.
 * There is deliberately NO 'klaar'/'ready' boolean: in a financial-truth app the
 * system cannot know a quarter is complete (it can't see a bon the client never
 * uploaded), so it reports what arrived + what the accountant has processed, and
 * lets the human draw the conclusion. Replaces the old lie-capable
 * computeClientStatus (klaar/bijna_klaar/wacht).
 */
export interface ClientReadiness {
  year: number
  quarter: number
  sharedInvoices: number       // all shared invoices in the quarter (both directions)
  processedInvoices: number    // of those, accountant_status = 'verwerkt' (human-asserted)
  openQuestions: number        // accountant_status = 'vraag' (an open question to the client)
  hasBankData: boolean         // bank_transactions dated in the quarter — the HONEST bank signal
  lastUploadDaysAgo: number | null  // days since the client's newest document (null = never)
  /**
   * [NO-SILENT-EMPTY] false = every count above was actually read. true = at least one read
   * failed, so the numbers are floors and not facts.
   *
   * supabase-js answers a failed query with { data: null, error } rather than throwing, and this
   * readiness was destructured as bare `{ count }` five times over. A failed count therefore read
   * as 0, and the accountant's board stated "0 open vragen" and the label "zonder bank" about a
   * client who had questions waiting and delivers statements every quarter. Those are the two
   * sentences this board exists to produce, and both are the kind an accountant acts on without
   * doubting — they see what we hand them and form a judgement their client is paying for.
   *
   * It sits on the CLIENT and not on the list: one unreadable count must not hide the other
   * thirty-nine clients, which is what promoting it to the list-level readFailed would do.
   */
  readFailed: boolean
}

/** Lightweight summary — used in client list and overview counts */
export interface ClientSummary {
  id: string                   // profiles.id of the ZZP'er
  full_name: string | null
  company_name: string | null
  email: string | null
  readiness: ClientReadiness   // honest facts — see ClientReadiness
  linked_at: string            // accountant_clients.created_at (ISO string)
}

/** Full detail — used in client detail page */
export interface ClientDetail extends ClientSummary {
  kvk_number: string | null
  btw_number: string | null
  iban: string | null
  address: string | null
  postal_code: string | null
  city: string | null
}

// ─────────────────────────────────────────────────────────
// Dashboard overview
// ─────────────────────────────────────────────────────────

/**
 * [READINESS] Honest headline counts for AccountantHome. No "ready for quarter"
 * verdict — that was a guess. These are provable facts across linked clients.
 */
export interface AccountantOverview {
  total_clients: number
  clients_with_open_questions: number   // ≥1 invoice with accountant_status='vraag'
  clients_missing_bank: number          // no bank_transactions in the current quarter
}

// ─────────────────────────────────────────────────────────
// Todo feed
// ─────────────────────────────────────────────────────────

export type TodoType =
  | 'invoices_to_process'   // paid invoices without accountant_status = 'verwerkt'
  | 'missing_file'          // current quarter has no bank document
  | 'client_question'       // invoices with accountant_status = 'vraag'

export interface TodoItem {
  client_id: string
  client_name: string          // company_name || full_name
  type: TodoType
  description: string          // Dutch, ready to display
  count?: number               // number of invoices affected (when relevant)
  /**
   * [KANTOOR-LINKS] The period this to-do was COUNTED over — the aangifte quarter, not today's.
   *
   * Every row here is "{klant} — … dit kwartaal", and the row used to open
   * `/dashboard/clients/{id}`, whose quarter grid defaults to the CALENDAR quarter. In the last
   * week of July that is Q3: the accountant read a to-do about Q2, tapped it, and arrived in a
   * quarter three weeks old and by definition nearly empty. The feed knows which period it meant;
   * carrying it is the whole fix.
   */
  year: number
  quarter: number
}

// ─────────────────────────────────────────────────────────
// Invoices (accountant view)
// ─────────────────────────────────────────────────────────

/**
 * [BRIDGE-A] Accountant sees: shared = true (GENERATED from status IN sent/received/paid).
 * Sections: Debiteuren (outgoing+sent) / Crediteuren (incoming+received) / Voldaan (paid).
 * btw_rate is NOT in DB — always compute: Math.round((btw_amount / total_ex_btw) * 100)
 */
export interface InvoiceRow {
  id: string
  invoice_number: string
  client_name: string | null
  status: string
  direction: string
  invoice_type: string
  total_ex_btw: number
  btw_amount: number
  total_inc_btw: number
  // [PARTIAL-PAY] Running total already settled (magnitude). The accountant must SEE that an
  // invoice is only partly paid BEFORE marking it 'verwerkt' — that lock freezes amount_paid
  // (invoice_accountant_write_guard), so a later instalment can no longer be booked by anyone.
  amount_paid?: number | null
  invoice_date: string
  due_date: string | null        // [BRIDGE-A] for computed Verlopen — never stored as status
  marked_paid_at: string | null  // when client marked paid — NOT actual payment date
  accountant_status: string | null
  accountant_note: string | null  // accountant-only, client never sees this
  replaced_by_number: string | null
}

// ─────────────────────────────────────────────────────────
// Quarter
// ─────────────────────────────────────────────────────────

export interface QuarterRange {
  start: string   // YYYY-MM-DD — inclusive
  end: string     // YYYY-MM-DD — inclusive
}

// [WERKBOARD] The per-client BTW filing agenda (AangifteAgenda / AangifteAgendaItem)
// was merged into the unified Aangifte & status board, which renders each client's
// RICH readiness (score + status from /api/readiness) instead of the lightweight
// facts these types carried. The pure deadline helpers in accountant.service
// (getAangifteDeadline / getActiveAangifte / daysUntil) live on — the board's
// deadline hero uses them — but these list types are no longer needed.