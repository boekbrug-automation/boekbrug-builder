'use client'

// src/app/dashboard/_shared/index.tsx
// مكونات مشتركة بين ZzpDashboard و AccountantDashboard
// [INTEGRATION] role-based nav links in DashboardHeader — May 2026
// [INTEGRATION] Logo Universal — next/link + role-aware href — May 2026

import { useRouter } from 'next/navigation'
import { useRef, useEffect } from 'react'
import React from 'react'
import Link from 'next/link'
import { InfiniteList } from '@/components/ui/InfiniteList'
import { StatusFilter } from '@/components/ui/StatusFilter'
import { InvoiceRowItem, type InvoiceRow as InvoiceListRow } from '@/components/invoice/InvoiceRow'
import { statusLabel } from '@/lib/invoice-status'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { BetaBadge } from '@/components/beta'
import { useInvoiceReconciliation } from '@/hooks/useInvoiceReconciliation'
import { SearchBar } from '@/components/search/SearchBar'
import { M3, FONT, PAGE_HEADER_HEIGHT } from '@/lib/design/tokens'
import type { InvoiceStatusFilter, AccountantStatusFilter } from '@/hooks/useInfiniteInvoices'
import type { ProfileRow, NotificationRow } from '@/types/rows'
import { safeNotificationLink } from '@/lib/notification-link'
// [LOGO-INITIALEN] Dezelfde functie als de factuur-PDF. Stond hier als een eigen regel die
// "Kiwi Food Market" tot KF maakte terwijl de PDF er KM van maakte — één bedrijf, twee monogrammen.
import { deriveInitials } from '@/lib/logo-initials'

// De header toont alleen naam, bedrijf, e-mail en rol. Door dát te vragen in plaats van een
// volledige ProfileRow mogen aanroepers een gerichte select doen zonder te liegen over wat
// ze hebben opgehaald.
// Geëxporteerd, want dit is de vorm die de home-keten al nodig had: de header werkte hier al
// mee, terwijl dashboard/page.tsx `select('*')` deed en de HELE profielrij doorgaf.
export type HeaderProfile = Pick<ProfileRow, 'id' | 'full_name' | 'company_name' | 'email' | 'role'>

// ── NavButton ─────────────────────────────────────────────────────────────────

export function NavButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="text-xs px-2.5 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
      style={{ color: 'var(--color-text-secondary)', fontWeight: 500, background: 'none', border: 'none' }}
    >
      {label}
    </button>
  )
}

// ── InvoiceTable — ZZP ────────────────────────────────────────────────────────

export interface ZzpInvoiceTableProps {
  mode: 'zzp'
  invoices: InvoiceListRow[]
  loading: boolean
  hasMore: boolean
  refreshing: boolean
  statusFilter: InvoiceStatusFilter
  onFilterChange: (s: InvoiceStatusFilter) => void
  onLoadMore: () => void
  onRefresh: () => void | Promise<void>
  onNavigate: (id: string) => void
  title?: string
  onMarkPaid?: (id: string, status: 'paid' | 'sent') => void
  onResend?: (e: React.MouseEvent, id: string) => void
  onDelete?: (id: string) => void
  onEdit?: (id: string) => void
  resendingId?: string | null
  showNewButton?: boolean
  onNewInvoice?: () => void
}

// ── InvoiceTable — Accountant ─────────────────────────────────────────────────

export interface AccountantInvoiceTableProps {
  mode: 'accountant'
  invoices: InvoiceListRow[]
  loading: boolean
  hasMore: boolean
  refreshing: boolean
  statusFilter: AccountantStatusFilter
  onFilterChange: (s: AccountantStatusFilter) => void
  onLoadMore: () => void
  onRefresh: () => void | Promise<void>
  onNavigate: (id: string) => void
  title?: string
  onAccountantAction: (id: string, action: 'verwerkt' | 'in_behandeling' | 'vraag' | null) => void
}

export type InvoiceTableProps = ZzpInvoiceTableProps | AccountantInvoiceTableProps

// ── InvoiceTable ──────────────────────────────────────────────────────────────

export function InvoiceTable(props: InvoiceTableProps) {
  const t = translator(useLocale())
  const {
    invoices, loading, hasMore, refreshing,
    statusFilter, onFilterChange,
    onLoadMore, onRefresh, onNavigate,
    title = 'Facturen',
  } = props

  const isAccountant = props.mode === 'accountant'

  // [BANK-RECON-BADGE] Owner-facing reconciliation badges (never in accountant mode).
  // Self-wired here so every consumer of the shared table gets them without prop threading.
  const router = useRouter()
  const taal = useLocale()
  const { byInvoice: reconByInvoice, confirmMatch } = useInvoiceReconciliation(!isAccountant)

  const emptyLabel = isAccountant
    ? statusFilter === 'all'
      ? t('lijst.geenBetaalde')
      : t('lijst.geenMetStatus', { status: statusFilter })
    : statusFilter === 'all'
      ? t('lijst.nogGeen')
      : t('lijst.geenMetStatus', { status: statusLabel(statusFilter, taal) })

  return (
    <div className="card overflow-hidden">

      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 border-b"
        style={{ borderColor: 'var(--color-separator)' }}
      >
        <h2 className="text-h3">{title}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={refreshing}
            // [ICOON-STIL] De enige knop in de app die niets anders bevat dan een icoon, en dat
            // icoon is aria-hidden — dus zonder label had een schermlezer hier "knop" en verder
            // niets. `title` alleen is niet genoeg: op touch verschijnt hij nooit, en een
            // schermlezer mag hem overslaan.
            aria-label={t('lijst.vernieuwen')}
            title={t('lijst.vernieuwen')}
            style={{ background: 'none', border: 'none', color: 'var(--color-text-tertiary)' }}
            className="hover:text-gray-500 transition-colors disabled:opacity-40"
          >
            <span className={`material-symbols-outlined ${refreshing ? 'animate-spin' : ''}`} style={{ fontSize: 20 }} aria-hidden>refresh</span>
          </button>

          {!isAccountant &&
            (props as ZzpInvoiceTableProps).showNewButton &&
            (props as ZzpInvoiceTableProps).onNewInvoice && (
              <button
                onClick={(props as ZzpInvoiceTableProps).onNewInvoice}
                className="bg-[#1a73e8] text-white text-sm px-4 py-2 rounded-xl hover:opacity-90 transition-opacity font-semibold"
              >
                + Nieuwe factuur
              </button>
            )}
        </div>
      </div>

      {/* Filter */}
      {isAccountant ? (
        <StatusFilter
          mode="accountant"
          value={statusFilter as AccountantStatusFilter}
          onChange={onFilterChange as (v: AccountantStatusFilter) => void}
        />
      ) : (
        <StatusFilter
          mode="zzp"
          value={statusFilter as InvoiceStatusFilter}
          onChange={onFilterChange as (v: InvoiceStatusFilter) => void}
        />
      )}

      {/* Lege staat */}
      {invoices.length === 0 && !loading ? (
        <p
          className="text-sm text-center py-12"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          {emptyLabel}
        </p>
      ) : (
        <div className="divide-y" style={{ borderColor: 'var(--color-separator)' }}>
          <InfiniteList
            onLoadMore={onLoadMore}
            hasMore={hasMore}
            loading={loading}
            onRefresh={async () => { await onRefresh() }}
            refreshing={refreshing}
          >
            {invoices.map(invoice => (
              <InvoiceRowItem
                key={invoice.id}
                invoice={invoice}
                onClick={() => onNavigate(invoice.id)}
                onAccountantAction={
                  isAccountant
                    ? (props as AccountantInvoiceTableProps).onAccountantAction
                    : undefined
                }
                onMarkPaid={
                  !isAccountant
                    ? (props as ZzpInvoiceTableProps).onMarkPaid
                    : undefined
                }
                onResend={
                  !isAccountant
                    ? (props as ZzpInvoiceTableProps).onResend
                    : undefined
                }
                onDelete={
                  !isAccountant
                    ? (props as ZzpInvoiceTableProps).onDelete
                    : undefined
                }
                onEdit={
                  !isAccountant
                    ? (props as ZzpInvoiceTableProps).onEdit
                    : undefined
                }
                resendingId={
                  !isAccountant
                    ? ((props as ZzpInvoiceTableProps).resendingId ?? null)
                    : null
                }
                recon={!isAccountant ? reconByInvoice[invoice.id] : undefined}
                onReconConfirm={!isAccountant ? async (id) => {
                  // [BANK-RECON-CONFIRM] Book a safe (reference-backed) match in one tap; the badge
                  // flips to "In bankafschrift" via the hook. An amount-only match ('navigate') opens
                  // the bank page to review; router.refresh() picks up the new paid status.
                  const r = await confirmMatch(id)
                  if (r === 'ok') router.refresh()
                  // [CIRKEL-C5] Het derde aanroeppunt dat bij de eerste ronde werd gemist: ook
                  // hier landt de sprong op de LIJN als het transactie-id bekend is.
                  else if (typeof r === 'object' && r.navigate) router.push(r.txId ? `/dashboard/bank/verdelen/${r.txId}` : '/dashboard/bank')
                } : undefined}
              />
            ))}
          </InfiniteList>
        </div>
      )}
    </div>
  )
}

// ── ProfileMenu ───────────────────────────────────────────────────────────────
// [BOEK-028] Profile dropdown — May 2026
// [INTEGRATION] Instellingen → /dashboard/settings — May 2026

/**
 * [MEDEWERKER] `links` is optioneel en vervangt de standaardregel (Instellingen).
 *
 * Dat is geen algemene flexibiliteit maar één concreet gat: /dashboard/settings staat niet in
 * SALES_SCREENS, dus voor een verkoopmedewerker was de enige regel in dit menu een deur die
 * dichtslaat — en eronder stond de enige uitlogknop van de app. Zie MedewerkerHeader.
 */
export function ProfileMenu({ profile, onLogout, links }: {
  profile: HeaderProfile
  onLogout: () => void
  links?: { label: string; href: string; icon: string }[]
}) {
  const t = translator(useLocale())
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const router = useRouter()

  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const initials = deriveInitials(profile.full_name || profile.company_name || 'U')

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(p => !p)}
        aria-label={t('kop.profielmenu')}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '4px 6px', borderRadius: 8,
        }}
      >
        <span style={{
          width: 28, height: 28, borderRadius: '50%',
          backgroundColor: '#1A73E8', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, flexShrink: 0,
        }}>
          {initials}
        </span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', insetInlineEnd: 0,
          backgroundColor: '#fff', border: '1px solid #E0E0E0',
          borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          minWidth: 180, zIndex: 100, overflow: 'hidden',
        }}>
          {/* User info */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#202124', margin: 0 }}>
              {profile.full_name || profile.company_name}
            </p>
            <p style={{ fontSize: 12, color: '#5F6368', margin: '2px 0 0' }}>
              {profile.email}
            </p>
          </div>

          {/* Instellingen — of, voor wie daar niet mag komen, zijn eigen regels. */}
          {(links ?? [{ label: t('kop.instellingen'), href: '/dashboard/settings', icon: 'settings' }]).map(link => (
            <button
              key={link.href}
              onClick={() => { setOpen(false); router.push(link.href) }}
              style={{
                width: '100%', padding: '10px 16px', textAlign: 'start',
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 14, color: '#202124', fontWeight: 500,
                borderBottom: '1px solid #F1F3F4',
                transition: 'background 0.1s ease',
              }}
              onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F8F9FA')}
              onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18, verticalAlign: -4, marginInlineEnd: 8, color: M3.onSurfaceVariant }} aria-hidden>{link.icon}</span>
              {link.label}
            </button>
          ))}

          {/* Uitloggen */}
          <button
            onClick={() => { setOpen(false); onLogout() }}
            style={{
              width: '100%', padding: '10px 16px', textAlign: 'start',
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 14, color: M3.error, fontWeight: 500,
              transition: 'background 0.1s ease',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#FFF0EE')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')}
          >
            {t('kop.uitloggen')}
          </button>
        </div>
      )}
    </div>
  )
}

// ── NotificationsBell ─────────────────────────────────────────────────────────
// [BOEK-028] Bell with outside click + markAsRead — May 2026

export function NotificationsBell({
  notifications, showNotifications, onToggle, onMarkAllRead, loadError, panelStyle,
}: {
  notifications: NotificationRow[]
  showNotifications: boolean
  onToggle: () => void
  onMarkAllRead?: () => void
  // [NO-SILENT-EMPTY] De meldingen konden niet worden gelezen. Zonder deze stand toont de bel
  // "Geen meldingen" — de enige zin die dit paneel nooit mag zeggen als het het niet weet.
  loadError?: string | null
  // [ZIJBALK-ACCOUNT] Where the panel opens. Below the bell by default (the header); the rail
  // hands in a fixed placement beside itself, because a panel inside its scroll box is clipped.
  panelStyle?: React.CSSProperties
}) {
  const t = translator(useLocale())
  const router = useRouter()
  const bellRef = useRef<HTMLDivElement>(null)
  const [readOverride, setReadOverride] = React.useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!showNotifications) return
    const handler = (e: MouseEvent) => {
      if (!bellRef.current?.contains(e.target as Node)) onToggle()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showNotifications])

  async function markAsRead(id: string) {
    setReadOverride(prev => ({ ...prev, [id]: true }))
    try {
      await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read: true }),
      })
    } catch { /* silent — optimistic already applied */ }
  }

  return (
    <div ref={bellRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={onToggle}
        aria-label={t('kop.meldingen')}
        style={{
          position: 'relative', background: 'none', border: 'none',
          cursor: 'pointer', padding: 8, borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, lineHeight: 1, transition: 'background 0.1s',
        }}
        onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F1F3F4')}
        onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')}
      >
        {/* [DESIGN] Was an emoji. The app ships a subsetted Material Symbols
            font and uses it for every other icon; an emoji here is drawn by the
            operating system, so its weight, colour and shape changed per device
            and could not be tinted to match the bar it sits in. These three sat
            in the chrome of every single page. */}
        <span className="material-symbols-outlined" style={{ fontSize: 22, color: M3.onSurfaceVariant }} aria-hidden>
          notifications
        </span>
        {(() => {
          const effectiveUnread = notifications.filter(n => !(readOverride[n.id] ?? n.read)).length
          return effectiveUnread > 0 ? (
            <span style={{
              position: 'absolute', top: 4, insetInlineEnd: 4,
              backgroundColor: M3.error, color: '#fff',
              fontSize: 9, fontWeight: 700, borderRadius: 9999,
              minWidth: 16, height: 16, padding: '0 3px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1, pointerEvents: 'none',
            }}>
              {effectiveUnread > 9 ? '9+' : effectiveUnread}
            </span>
          ) : null
        })()}
      </button>

      {showNotifications && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', insetInlineEnd: 0,
          backgroundColor: '#fff', border: '1px solid #E0E0E0',
          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          width: 320, zIndex: 200, overflow: 'hidden',
          ...panelStyle,
        }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #E0E0E0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#202124', margin: 0 }}>{t('kop.meldingen')}</p>
            {/* [BRIDGE-NOTIF] explicit mark-all-read — user stays in control, no auto-clear on open */}
            {onMarkAllRead && notifications.some(n => !(readOverride[n.id] ?? n.read)) && (
              <button
                onClick={() => {
                  // optimistic local clear so the badge/highlight update instantly
                  setReadOverride(prev => {
                    const next = { ...prev }
                    notifications.forEach(n => { next[n.id] = true })
                    return next
                  })
                  onMarkAllRead()
                }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 500, color: '#1A73E8',
                  padding: '2px 4px', borderRadius: 4, whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F1F3F4')}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')}
              >
                {t('kop.allesGelezen')}
              </button>
            )}
          </div>
          {loadError ? (
            <p style={{ fontSize: 13, color: '#B3261E', textAlign: 'center', padding: '24px 16px', margin: 0, lineHeight: 1.5 }}>
              {loadError}
            </p>
          ) : notifications.length === 0 ? (
            <p style={{ fontSize: 14, color: '#5F6368', textAlign: 'center', padding: '32px 16px', margin: 0 }}>
              {t('kop.geenMeldingen')}
            </p>
          ) : (
            <div style={{ maxHeight: 320, overflowY: 'auto' }}>
              {notifications.map(n => {
                // [MELDING-TIK] The link is checked HERE, not trusted from the row. Two of the
                // routes that write notifications take `link` straight from a request body, so
                // the value in this column is not necessarily one this app composed. The push
                // side has always checked it; the screen did not, and did router.push() on it raw.
                const href = safeNotificationLink(n.link)
                const ongelezen = !(readOverride[n.id] ?? n.read)
                // [MELDING-TIK] Every row responds to a tap, not only the ones that go somewhere.
                // Measured on production: 295 of 1031 notifications (28,6%) carry no link at all —
                // "Inkoopfactuur betaald" has one on none of its 96 rows. A tap on those did
                // nothing whatsoever: no navigation, and no mark-as-read either, so the row stayed
                // blue and the badge kept counting it. The only way to clear one was the
                // mark-ALL-read button, which also clears the ones you have not looked at yet.
                // Reading a notification you cannot act on is still an act, and it is the whole
                // meaning of the unread state.
                const acteer = () => {
                  if (ongelezen) markAsRead(n.id)
                  if (href) { router.push(href); onToggle() }
                }
                return (
                <div
                  key={n.id}
                  // [MOTION] A notification row is a link in everything but tag
                  // name. It now presses like one (pressable-row tints on
                  // :active, which touch fires — the old JS hover never did),
                  // and can be reached and opened from the keyboard.
                  role="button"
                  tabIndex={0}
                  className="pressable-row notification-row"
                  onClick={acteer}
                  onKeyDown={e => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    acteer()
                  }}
                  style={{
                    padding: '12px 16px', borderBottom: '1px solid #F1F3F4',
                    backgroundColor: ongelezen ? '#E8F0FE' : 'transparent',
                    cursor: href ? 'pointer' : 'default',
                  }}
                >
                  <p style={{ fontSize: 13, fontWeight: 500, color: '#202124', margin: 0 }}>{n.title}</p>
                  {n.body && <p style={{ fontSize: 12, color: '#5F6368', margin: '2px 0 0' }}>{n.body}</p>}
                  <p style={{ fontSize: 11, color: '#70757a', margin: '4px 0 0' }}>
                    {n.created_at ? new Date(n.created_at).toLocaleDateString('nl-NL') : ''}
                  </p>
                </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── AccountantNavLinks ────────────────────────────────────────────────────────
// [INTEGRATION] Accountant-only nav links — Werkplek + Klanten — May 2026

function AccountantNavLinks() {
  const router = useRouter()

  const links = [
    // [ROLE-PARITY] 'Werkplek' link removed — the werkplek tools now live as a tile
    // grid on the accountant home, and the logo already returns there, so a nav
    // link to it was redundant. 'Klanten' stays as the one quick portfolio jump.
    { label: 'Klanten',  href: '/dashboard/clients/beheer' },
  ]

  return (
    // [HEADER-SYSTEM] Hidden on small screens (see .dash-nav-links in globals.css):
    // on mobile the search + icons crowd this text link; Klanten is also reachable
    // from the accountant home.
    <div className="dash-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      {links.map(({ label, href }) => (
        <button
          key={href}
          onClick={() => router.push(href)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '6px 10px', borderRadius: 6,
            fontSize: 13, fontWeight: 500, color: '#5F6368',
            transition: 'background 0.1s, color 0.1s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => {
            const b = e.currentTarget as HTMLButtonElement
            b.style.backgroundColor = '#F1F3F4'
            b.style.color = '#1A73E8'
          }}
          onMouseLeave={e => {
            const b = e.currentTarget as HTMLButtonElement
            b.style.backgroundColor = 'transparent'
            b.style.color = '#5F6368'
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ── ZzpNavLinks ───────────────────────────────────────────────────────────────
// [TODAY-NAV-LINK] Owner-only nav link — "Vandaag" → /dashboard/vandaag.
// Mirrors AccountantNavLinks exactly (same pattern, colors, hover). Shown only
// for the ZZP'er in the header; does NOT change the default home (getHomePath
// stays '/dashboard'). Adding more owner links later = append to `links`.

function ZzpNavLinks() {
  const router = useRouter()

  const links = [
    { label: 'Vandaag', href: '/dashboard/vandaag' },
  ]

  return (
    // [HEADER-SYSTEM] Hidden on small screens (see .dash-nav-links in globals.css)
    // to declutter the mobile header; "Vandaag" stays reachable by route.
    <div className="dash-nav-links" style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      {links.map(({ label, href }) => (
        <button
          key={href}
          onClick={() => router.push(href)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '6px 10px', borderRadius: 6,
            fontSize: 13, fontWeight: 500, color: '#5F6368',
            transition: 'background 0.1s, color 0.1s',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => {
            const b = e.currentTarget as HTMLButtonElement
            b.style.backgroundColor = '#F1F3F4'
            b.style.color = '#1A73E8'
          }}
          onMouseLeave={e => {
            const b = e.currentTarget as HTMLButtonElement
            b.style.backgroundColor = 'transparent'
            b.style.color = '#5F6368'
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ── DashboardHeader ───────────────────────────────────────────────────────────
// [BOEK-028] Responsive single-row header — no flex-wrap — May 2026
// [INTEGRATION] role-based nav + Logo Universal (next/link, role-aware) — May 2026

interface DashboardHeaderProps {
  profile: HeaderProfile
  notifications: NotificationRow[]
  showNotifications: boolean
  unreadMessages: number
  onToggleNotifications: () => void
  onMessagesClick: () => void
  onLogout: () => void
  // [BRIDGE-NOTIF] explicit "mark all read" — replaces the old auto-clear on open
  onMarkAllRead?: () => void
  // [NO-SILENT-EMPTY] Doorgegeven aan de bel: melden dat de meldingen niet gelezen konden worden.
  notificationsError?: string | null
}

export function DashboardHeader({
  profile,
  notifications,
  showNotifications,
  unreadMessages,
  onToggleNotifications,
  onMessagesClick,
  onLogout,
  onMarkAllRead,
  notificationsError,
}: DashboardHeaderProps) {
  const t = translator(useLocale())
  // [INTEGRATION] Logo Universal — role-aware href — May 2026
  const isAccountant = profile?.role === 'accountant'
  const logoHref = isAccountant ? '/dashboard/accountant' : '/dashboard'

  // [HEADER-SYSTEM] Home top bar. Height + surface/border/font come from the
  // shared tokens so it stays in lockstep with the sub-page bar (SubPageHeader);
  // see docs/HEADER_SYSTEM.md.
  //
  // [SAFE-AREA] The two bars must handle the notch identically. SubPageHeader
  // already padded itself by env(safe-area-inset-top) and grew its height to
  // match; this one did not — it just sat at top:0 with a fixed height. That
  // difference was invisible while viewportFit was unset (every inset resolved
  // to 0), but the moment cover is enabled in app/layout.tsx it becomes the one
  // bar in the app that renders underneath the status bar. Same two lines as
  // SubPageHeader, so the two homes and every sub-page now clear the notch.
  return (
    <header style={{
      position: 'sticky',
      top: 0,
      zIndex: 50,
      backgroundColor: M3.surface,
      borderBottom: `1px solid ${M3.outlineVariant}`,
      height: `calc(${PAGE_HEADER_HEIGHT}px + env(safe-area-inset-top))`,
      display: 'flex',
      alignItems: 'center',
      // NB: the `padding` shorthand must stay ABOVE paddingTop — it resets all
      // four sides, so listing it after would wipe the safe-area inset out.
      padding: '0 16px',
      paddingTop: 'env(safe-area-inset-top)',
      gap: 8,
      fontFamily: FONT,
    }}>

      {/* Logo — [INTEGRATION] next/link + role-aware href — May 2026 */}
      {/* [HEADER-SYSTEM] Colour and font come from the tokens, exactly like the
          sub-page bar's wordmark — the literals here were the same two values
          spelled by hand ('#1A73E8' = M3.primary), which is how the two bars
          drift apart in the first place. */}
      <Link
        href={logoHref}
        style={{
          fontWeight: 700, fontSize: 17, color: M3.primary,
          flexShrink: 0, letterSpacing: '-0.3px', lineHeight: 1,
          textDecoration: 'none', cursor: 'pointer',
          fontFamily: FONT,
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '0.75')}
        onMouseLeave={e => ((e.currentTarget as HTMLAnchorElement).style.opacity = '1')}
      >
        BoekBrug
      </Link>
      {/* [BETA] Inside the app the fact is a label, never a paragraph: one word beside the name,
          in the owner's own language. The sentence stands once, on the public homepage. */}
      <BetaBadge label={t('kop.beta')} />

      {/* Search — and the bar's only FLEXIBLE cell, which is what keeps the
          trailing controls on the right edge.
          [HEADER-ALIGN] This used to be capped at 480 while SearchBar draws
          itself at maxWidth 320, so the cap produced nothing but 160px of dead
          space after the field — and because every remaining child is
          flexShrink: 0 with no auto margin anywhere, the whole row stopped
          growing at ~790px. On any screen wider than that the wordmark sat at
          the left edge, the nav link, messages, notifications and avatar sat
          stranded in the middle, and the rest of the bar was empty — while the
          page column below it is centred, and the sub-page bar (SubPageHeader,
          whose title cell is the flexible one) puts its actions hard right. Two
          bars, two different places for the same controls.
          Dropping the cap lets this cell absorb the slack instead: the field
          keeps its own 320 width, and the trailing cluster ends up at the right
          edge at every width — the same shape as the sub-page bar. */}
      <div style={{ flex: 1, minWidth: 0, margin: '0 4px' }}>
        <SearchBar />
      </div>

      {/* [ZIJBALK-ACCOUNT] Everything from here to the end of the bar is the account corner, and
          from 1024px it is drawn in the rail instead — RailAccount, and .dash-header-account in
          globals.css, which hides this at the SAME breakpoint that shows the rail. Below that width
          nothing changes: a phone has no rail. The inline display loses to the !important there,
          which is the point. */}
      <div className="dash-header-account" style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      {/* [INTEGRATION] Accountant nav links — only when role = accountant — May 2026 */}
      {isAccountant && <AccountantNavLinks />}

      {/* [TODAY-NAV-LINK] Owner nav links — only when role = zzper */}
      {!isAccountant && <ZzpNavLinks />}

      {/* Right icons */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>

        {/* Messages */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={onMessagesClick}
            aria-label={t('kop.berichten')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 8, borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, lineHeight: 1, transition: 'background 0.1s',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = '#F1F3F4')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent')}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 22, color: M3.onSurfaceVariant }} aria-hidden>
              forum
            </span>
          </button>
          {unreadMessages > 0 && (
            <span style={{
              position: 'absolute', top: 4, insetInlineEnd: 4,
              backgroundColor: '#1A73E8', color: '#fff',
              fontSize: 9, fontWeight: 700, borderRadius: 9999,
              minWidth: 16, height: 16, padding: '0 3px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none',
            }}>
              {unreadMessages > 9 ? '9+' : unreadMessages}
            </span>
          )}
        </div>

        {/* Notifications bell */}
        <NotificationsBell
          notifications={notifications}
          showNotifications={showNotifications}
          onToggle={onToggleNotifications}
          onMarkAllRead={onMarkAllRead}
          loadError={notificationsError}
        />

        {/* Avatar + profile dropdown */}
        <ProfileMenu profile={profile} onLogout={onLogout} />

      </div>
      </div>
      {/* [ZIJBALK-ACCOUNT] end of the corner — the gate reads up to this line, so anything
          placed after it stays on screen beside the rail. Keep it the last thing in the bar. */}
    </header>
  )
}