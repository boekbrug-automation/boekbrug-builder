// src/lib/period-invoice-tabs.ts
// [KWT-TABS] The three sibling views of one quarter's invoices, and the rules for choosing between
// them. Pure: no React, no DOM, no fetch. Run: npx tsx --test src/lib/period-invoice-tabs.test.ts
//
// WHY THIS FILE EXISTS
//
// The accountant's quarter screen rendered Debiteuren, Crediteuren and Voldaan as three lists
// stacked one under the other. For a retail quarter that is a wall several screens long, and the
// accountant scrolls past two complete lists to reach the one they came for. The three are not a
// sequence — they are the same dataset seen three ways — so they became tabs.
//
// The rules that make that safe are the ones below, and every one of them is here rather than in
// the screen because a screen cannot be tested without a browser and these are the parts that are
// wrong in a way nobody sees:
//
//   · THE PREDICATES ARE NOT RE-DECIDED. `INVOICE_SECTIONS` is the same three filters the page has
//     rendered since [BRIDGE-A]; they MOVED here so the tab a row belongs to and the list it is
//     rendered in are one answer, not two that can drift. A row that was Debiteuren is Debiteuren.
//   · UNKNOWN IS NOT ZERO. `countInvoiceTabs` answers `null` for a read that failed or has not
//     come back, and never `{debiteuren: 0, …}`. "Crediteuren 0" above a failed read is a claim
//     about someone else's administration that the app is in no position to make.
//   · A DEEP LINK OUTRANKS A TAB. Batch 2 promises that a notification lands on its invoice. If
//     `?focus=` names a purchase invoice and `?tab=` says debiteuren, honouring the tab would hide
//     the invoice the link exists to show. `focusInvoiceTab` resolves the section from the row
//     itself, and the screen selects it.
//
// What this module does NOT do: decide what an invoice IS. No status is derived here, no amount,
// no period. It arranges rows that were already classified.

/** The fields a section predicate reads — nothing else about an invoice matters here. */
export interface SectionInvoice {
  direction?: string | null
  status?: string | null
}

/**
 * The three views, in the order they appear on screen.
 *
 * [BRIDGE-A] Accounting split, accountant terminology. The filters are verbatim what the quarter
 * page has always applied; `titleKey`/`subKey` are the catalogue keys it has always rendered.
 * [TAAL] `key` is an identifier and a URL value — never translated. Only the labels are.
 */
export const INVOICE_SECTIONS = [
  {
    key: 'debiteuren',
    titleKey: 'bh.kwt.sectie.debiteuren',
    subKey: 'bh.kwt.sectie.debiteurenSub',
    filter: (i: SectionInvoice) => i.direction === 'outgoing' && i.status === 'sent',
  },
  {
    key: 'crediteuren',
    titleKey: 'bh.kwt.sectie.crediteuren',
    subKey: 'bh.kwt.sectie.crediteurenSub',
    filter: (i: SectionInvoice) => i.direction === 'incoming' && i.status === 'received',
  },
  {
    key: 'voldaan',
    titleKey: 'bh.kwt.sectie.voldaan',
    subKey: 'bh.kwt.sectie.voldaanSub',
    filter: (i: SectionInvoice) => i.status === 'paid',
  },
] as const

export type InvoiceSection = (typeof INVOICE_SECTIONS)[number]
export type InvoiceTabKey = InvoiceSection['key']

/** The view the screen opens on when nothing asks for another one. */
export const DEFAULT_INVOICE_TAB: InvoiceTabKey = 'debiteuren'

export const INVOICE_TAB_KEYS: readonly InvoiceTabKey[] = INVOICE_SECTIONS.map((s) => s.key)

export function isInvoiceTabKey(value: unknown): value is InvoiceTabKey {
  return typeof value === 'string' && (INVOICE_TAB_KEYS as readonly string[]).includes(value)
}

/**
 * The view a `?tab=` parameter asks for.
 *
 * Anything else — absent, misspelled, a value from a future release, a hand-edited URL — falls to
 * Debiteuren rather than to an empty screen. An unreadable parameter is not an error worth a page
 * about; it is a request the app cannot honour, and the default is a real answer.
 */
export function readInvoiceTab(raw: string | null | undefined): InvoiceTabKey {
  return isInvoiceTabKey(raw) ? raw : DEFAULT_INVOICE_TAB
}

export function invoiceSection(key: InvoiceTabKey): InvoiceSection {
  const found = INVOICE_SECTIONS.find((s) => s.key === key)
  // Unreachable through the type, reachable through a cast. Returning the default beats throwing
  // on a screen whose job is to show money.
  return found ?? INVOICE_SECTIONS[0]
}

/**
 * Which of the three views an invoice belongs to, or null when it belongs to none.
 *
 * The same predicates the list renders, applied in the same order — so "the tab the row is in" and
 * "the list the row appears in" cannot disagree. Null is a real answer: the page's two queries can
 * only produce rows the three sections cover, but a row that slipped through must not be silently
 * filed under Debiteuren, where the accountant would read it as a receivable.
 */
export function invoiceTabOf(inv: SectionInvoice | null | undefined): InvoiceTabKey | null {
  if (!inv) return null
  return INVOICE_SECTIONS.find((s) => s.filter(inv))?.key ?? null
}

/** The rows of one view, in the order they were handed over. */
export function invoiceTabRows<T extends SectionInvoice>(
  rows: readonly T[],
  key: InvoiceTabKey,
): T[] {
  return rows.filter(invoiceSection(key).filter)
}

/**
 * How many rows each view holds — or null when that is not known.
 *
 * `rows` is null for a read that failed and for one that has not answered yet. Both are UNKNOWN,
 * and the caller must render no number at all: a zero beside Crediteuren says the client has no
 * purchase invoices this quarter, which is exactly the sentence a failed read may not produce.
 * The same rule the invoice list itself obeys ([NO-SILENT-EMPTY]) — a count is a claim too.
 *
 * Counts are taken over the rows the caller is actually going to show, search included, so a tab
 * never advertises eight invoices and then opens on none.
 */
export function countInvoiceTabs(
  rows: readonly SectionInvoice[] | null | undefined,
): Record<InvoiceTabKey, number> | null {
  if (!rows) return null
  const counts = { debiteuren: 0, crediteuren: 0, voldaan: 0 }
  for (const row of rows) {
    const key = invoiceTabOf(row)
    if (key) counts[key] += 1
  }
  return counts
}

/**
 * The view a `?focus=` deep link forces, or null when it forces nothing.
 *
 * [BRIDGE-NOTIF] A notification carries the accountant to one invoice. If that invoice sits in
 * Crediteuren and the link also carries `tab=debiteuren` — a stale bookmark, a link built before
 * the invoice was paid, a hand-edited URL — then honouring the tab hides the one row the link
 * exists for. The invoice wins, because the invoice is what was asked for.
 *
 * Null when there is no focus, when the rows have not been read (nothing can be resolved yet, and
 * guessing would fight the URL), or when the focused invoice is not in this quarter at all — that
 * last one keeps the existing best-effort behaviour rather than inventing a second fetch.
 */
export function focusInvoiceTab(
  focusId: string | null | undefined,
  rows: readonly (SectionInvoice & { id: string })[] | null | undefined,
): InvoiceTabKey | null {
  if (!focusId || !rows) return null
  return invoiceTabOf(rows.find((r) => r.id === focusId))
}

/**
 * The next view under an arrow key, wrapping at both ends.
 *
 * Wrapping is what the WAI-ARIA tabs pattern specifies, and with three tabs it is also the only
 * behaviour that does not leave a keyboard user pressing a key that does nothing.
 */
export function neighbourInvoiceTab(current: InvoiceTabKey, step: 1 | -1): InvoiceTabKey {
  const keys = INVOICE_TAB_KEYS
  const at = keys.indexOf(current)
  const from = at === -1 ? 0 : at
  return keys[(from + step + keys.length) % keys.length]
}

/**
 * What a key press means in the tab strip, or null when the key is not ours to take.
 *
 * Pure, and separate from the component, because the half that is wrong in a way nobody reports is
 * the DIRECTION. ArrowRight means "the tab to the right of this one". In Arabic the strip lays out
 * right to left, so the tab to the right is the PREVIOUS one — an interface that ignores that
 * moves the selection backwards from every arrow key, for the one audience nobody tests in.
 *
 * Home and End are the ends of the LIST, not of the screen, so they do not mirror.
 */
export function invoiceTabKeyAction(
  key: string,
  active: InvoiceTabKey,
  dir: 'ltr' | 'rtl',
): InvoiceTabKey | null {
  const forward = dir === 'rtl' ? -1 : 1
  switch (key) {
    case 'ArrowRight': return neighbourInvoiceTab(active, forward)
    case 'ArrowLeft': return neighbourInvoiceTab(active, forward === 1 ? -1 : 1)
    case 'Home': return INVOICE_TAB_KEYS[0]
    case 'End': return INVOICE_TAB_KEYS[INVOICE_TAB_KEYS.length - 1]
    default: return null
  }
}

/**
 * The DOM ids that tie a tab to its panel.
 *
 * Here rather than in either component because `aria-controls` on the tab and `aria-labelledby` on
 * the panel have to spell the same string, and the two are rendered in different files. One
 * function per side means a rename cannot break the association silently — an association a
 * screen reader needs and a sighted reviewer never sees.
 */
export function invoiceTabId(key: InvoiceTabKey): string {
  return `kwt-tab-${key}`
}

export function invoiceTabPanelId(key: InvoiceTabKey): string {
  return `kwt-tabpaneel-${key}`
}

/**
 * The same URL, with `tab` set to this view.
 *
 * Every other parameter travels unchanged — `q` and `year` are the period this screen IS, and
 * `focus` is a deep link the accountant may still want to follow back. Selecting a tab is a view
 * change, not a navigation to somewhere else, and a query string that quietly drops half of itself
 * turns one into the other.
 */
export function invoiceTabHref(
  pathname: string,
  search: URLSearchParams | string | null | undefined,
  tab: InvoiceTabKey,
): string {
  const params = new URLSearchParams(
    typeof search === 'string' ? search.replace(/^\?/, '') : (search ?? undefined),
  )
  params.set('tab', tab)
  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}
