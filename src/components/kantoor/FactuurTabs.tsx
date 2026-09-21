'use client'

// src/components/kantoor/FactuurTabs.tsx
// [KWT-TABS] The tab strip above the quarter's invoices. Presentation only.
//
// WHAT IT IS, AND WHAT IT REFUSES TO BE
//
// Three real tabs — `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, arrow keys,
// one tab stop for the whole strip — and not three buttons that merely look like tabs. That
// difference is invisible on a screen and total on a keyboard: with three ordinary buttons the
// accountant tabs three times to get past the strip, and a screen reader announces three unrelated
// controls instead of "tab 2 of 3, selected".
//
// It holds no language of its own: every word comes out of the catalogue through `t`, and the
// component receives which view is active rather than deciding. Direction travels with the words —
// in Arabic the strip lays out right to left and the arrow keys mirror with it, because
// ArrowRight means "the tab to the right" and in an RTL strip that is the PREVIOUS one.
//
// A COUNT IS A CLAIM. `counts` is null when the invoice read failed or has not answered, and then
// no number is drawn at all. «Crediteuren 0» over a failed read tells the accountant this client
// booked no purchase invoices this quarter — a statement about someone else's administration that
// a dead socket is in no position to make. Unknown is not zero, here as everywhere else.
//
// MOBILE. The labels never wrap: at 320px three Arabic labels with counts do not fit, and a strip
// that breaks into two rows is the vertical wall this whole change exists to remove. It scrolls
// sideways instead, which keeps the header exactly one line tall at every width.

import { useRef } from 'react'
import type { Translator } from '@/lib/i18n/t'
import { M3 } from '@/lib/design/tokens'
import {
  INVOICE_SECTIONS,
  invoiceTabId,
  invoiceTabKeyAction,
  invoiceTabPanelId,
  type InvoiceTabKey,
} from '@/lib/period-invoice-tabs'

export interface FactuurTabsProps {
  /** The view on screen now. */
  active: InvoiceTabKey
  /** Rows per view, or null when the read did not answer — then no number is drawn. */
  counts: Record<InvoiceTabKey, number> | null
  onSelect: (key: InvoiceTabKey) => void
  t: Translator
  /** Text direction of the interface, so the arrow keys mean what the screen shows. */
  dir: 'ltr' | 'rtl'
  /** The id of the heading this strip belongs to, so the tablist is named by it. */
  labelledBy: string
}

export default function FactuurTabs({ active, counts, onSelect, t, dir, labelledBy }: FactuurTabsProps) {
  const tabRefs = useRef<Partial<Record<InvoiceTabKey, HTMLButtonElement | null>>>({})

  /** Move the selection AND the focus — automatic activation, which is what a tab set with no
   *  network cost per view should do: the rows are already in memory, so arrowing through the
   *  three views costs nothing and asking for a second keypress to confirm is friction. */
  const ga = (key: InvoiceTabKey) => {
    onSelect(key)
    tabRefs.current[key]?.focus()
  }

  // Which key means which tab — including the mirroring Arabic needs — is decided in the pure
  // module and proven there. Enter and Space need no case: these are <button>s, so the browser
  // already turns both into a click, and a second handler would fire the selection twice.
  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const next = invoiceTabKeyAction(e.key, active, dir)
    if (!next) return
    e.preventDefault()
    ga(next)
  }

  return (
    <div
      role="tablist"
      aria-labelledby={labelledBy}
      aria-orientation="horizontal"
      style={{
        display: 'flex',
        gap: 4,
        padding: '8px 12px',
        borderBottom: '1px solid #E0E0E0',
        // One line at every width. See the header: a two-row tab strip is a new wall.
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'thin',
      }}
    >
      {INVOICE_SECTIONS.map((section) => {
        const selected = section.key === active
        const count = counts ? counts[section.key] : null
        return (
          <button
            key={section.key}
            ref={(el) => { tabRefs.current[section.key] = el }}
            id={invoiceTabId(section.key)}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={invoiceTabPanelId(section.key)}
            // Roving tabindex: the strip is ONE tab stop, and the arrow keys move inside it.
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(section.key)}
            onKeyDown={onKey}
            style={{
              flexShrink: 0,
              whiteSpace: 'nowrap',
              minHeight: 40,
              padding: '9px 14px',
              borderRadius: 999,
              border: selected ? '1px solid #1A73E8' : '1px solid transparent',
              backgroundColor: selected ? '#E8F0FE' : 'transparent',
              color: selected ? '#1967D2' : M3.onSurfaceVariant,
              fontSize: 13,
              fontWeight: selected ? 600 : 500,
              fontFamily: "'Roboto', sans-serif",
              cursor: 'pointer',
            }}
          >
            {t(section.titleKey)}
            {count !== null && (
              <span
                style={{
                  marginInlineStart: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  color: selected ? '#1967D2' : '#5F6368',
                  fontFamily: "'Roboto Mono', monospace",
                }}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
