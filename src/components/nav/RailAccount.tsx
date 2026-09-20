'use client'

// src/components/nav/RailAccount.tsx
// [ZIJBALK-ACCOUNT] The account corner, moved into the rail.
//
// ── WHAT MOVED, AND WHY HERE ──
//
// The home bar's trailing corner — the Vandaag link, Berichten, the bell and the avatar menu with
// the name, the e-mail, Instellingen and Uitloggen — sat at the top right of the two home screens
// and nowhere else: every other screen has the lightweight sub-page bar, so on those the bell and
// the way out were a trip home away. The owner asked for all of it in the rail, and at that width
// the rail is the better place regardless: it is on EVERY dashboard screen, so the bell that
// carries "your invoice was NOT sent" is now in view while you are on the invoice.
//
// The corner itself is hidden from 1024px (globals.css, .dash-header-account) — the same
// breakpoint that shows the rail, so at no width is it in both places or in neither. Below it the
// bar keeps its corner exactly as it was; a phone has no rail to move it into.
//
// ── WHAT THIS DOES NOT DO ──
//
// It does not build a Supabase client during render. The layout renders this on the server and so
// do the render tests; the client is built on first use inside the effect (getBrowserClient — the
// rule at the foot of lib/supabase.ts, written after a build died on exactly this).
//
// The notifications are read here separately from the home's own read. The two live in different
// trees (this in the layout, that in the page) and cannot share state without lifting it above
// both. One extra 20-row read, on the home only. Named here rather than hidden.
//
// The bell's panel opens FIXED beside the rail, not below the bell: the rail is its own scroll box
// (overflowY: auto), and an absolutely positioned panel inside a scroll box is clipped by it.
// Fixed escapes the box; --rail-w keeps it clear of the rail's width, at every width the rail is
// drawn — the rule the [ZIJBALK] gate holds for everything that pins to that edge.

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type CSSProperties } from 'react'
import { getBrowserClient } from '@/lib/supabase'
import { M3, FONT } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import { deriveInitials } from '@/lib/logo-initials'
import type { NotificationRow } from '@/types/rows'
import type { Role } from '@/lib/navigation'
import { NotificationsBell } from '@/app/dashboard/_shared'
import { useToast } from '@/components/ui/Toast'

export interface RailAccountInfo {
  id: string
  /** The owner's name, or the company's when no name is on file. Empty when neither is. */
  name: string
  email: string | null
}

// One 44px target per control — the header's own size, and the minimum a finger needs.
const CONTROL: CSSProperties = {
  position: 'relative',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 8,
  borderRadius: 8,
  minWidth: 44,
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textDecoration: 'none',
  fontFamily: FONT,
}

const BADGE: CSSProperties = {
  position: 'absolute',
  top: 4,
  insetInlineEnd: 4,
  backgroundColor: M3.primary,
  color: '#fff',
  fontSize: 9,
  fontWeight: 700,
  borderRadius: 9999,
  minWidth: 16,
  height: 16,
  padding: '0 3px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1,
  pointerEvents: 'none',
}

export function RailAccount({ account, role }: { account: RailAccountInfo; role: Role | null }) {
  const t = translator(useLocale())
  const router = useRouter()
  const showToast = useToast()
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  // [NO-SILENT-EMPTY] A read that failed is not "Geen meldingen". The bell is where a question
  // from the boekhouder arrives; "there is nothing" is the costliest sentence it can say when it
  // does not know. Same rule as the home and the medewerker's header.
  const [notifError, setNotifError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [accountantId, setAccountantId] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const supabase = getBrowserClient()
    ;(async () => {
      const [{ data: notifData, error: notifErr }, { count, error: countErr }] = await Promise.all([
        supabase.from('notifications').select('*').eq('user_id', account.id).order('created_at', { ascending: false }).limit(20),
        supabase.from('messages').select('id', { count: 'exact', head: true }).eq('receiver_id', account.id).eq('read', false),
      ])
      if (!live) return
      if (notifErr) {
        console.error('[ZIJBALK-ACCOUNT] notifications could not be read:', notifErr.message)
        setNotifError(t('start.meldingenFout'))
      } else {
        setNotifError(null)
        setNotifications(notifData ?? [])
      }
      // A badge that stays away is silent; a badge that says 0 is a claim. A failed count stays away.
      setUnreadMessages(countErr ? 0 : count || 0)
      if (countErr) console.error('[ZIJBALK-ACCOUNT] unread messages could not be counted:', countErr.message)
      // The owner's Berichten door opens the conversation with their boekhouder when they have one,
      // exactly as the home's did. An accountant has no single counterpart: the list.
      if (role !== 'accountant') {
        const { data: link } = await supabase.from('accountant_clients').select('accountant_id').eq('zzper_id', account.id).maybeSingle()
        if (live && link?.accountant_id) setAccountantId(link.accountant_id)
      }
    })()
    return () => { live = false }
    // The translator is stable for a locale; only the account and the role decide what is read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, role])

  async function markAllRead(): Promise<boolean> {
    // The screen may only say "read" once it is stored — the home's rule, for the same reason.
    // [MELDING-WAARHEID] The outcome is returned: the bell takes its local mark back on a false.
    const { error } = await getBrowserClient()
      .from('notifications')
      .update({ read: true })
      .eq('user_id', account.id)
      .eq('read', false)
    if (error) {
      console.error('[ZIJBALK-ACCOUNT] marking notifications read failed:', error.message)
      return false
    }
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    return true
  }

  async function logout() {
    // [UITLOGGEN] signOut() keeps the local session when the server refused, so navigating to
    // /login as if it worked only bounced the owner straight back, with no word. Say it, and stay
    // signed in — which is the truth. Same rule as the home bar's own way out.
    const { error } = await getBrowserClient().auth.signOut()
    if (error) {
      console.error('[ZIJBALK-ACCOUNT] signing out failed:', error.message)
      showToast(t('kop.uitloggenMislukt'), { tone: 'error' })
      return
    }
    router.push('/login')
  }

  const messagesHref = accountantId ? `/dashboard/messages/${accountantId}` : '/dashboard/messages'
  const initials = deriveInitials(account.name || 'U')

  return (
    <div
      style={{
        marginInline: 8,
        padding: '2px 2px 8px',
        borderBottom: `1px solid ${M3.outlineVariant}`,
        marginBottom: 6,
        fontFamily: FONT,
      }}
    >
      {/* Who is signed in. The name and the e-mail were behind the avatar; here they stand in the
          open, which on a shared counter machine is the first thing worth knowing. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px' }}>
        <span
          aria-hidden
          style={{
            width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
            background: M3.primary, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700,
          }}
        >
          {initials}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: M3.onSurface, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'start' }}>
            {account.name}
          </div>
          {account.email && (
            <div style={{ fontSize: 11.5, color: M3.mutedText, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'start' }}>
              {account.email}
            </div>
          )}
        </div>
      </div>

      {/* The corner's four controls, in the corner's order: the bell, Berichten, then what the
          avatar menu held — Instellingen and the way out. */}
      <div role="group" aria-label={t('kop.profielmenu')} style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 2px' }}>
        <NotificationsBell
          notifications={notifications}
          showNotifications={open}
          onToggle={() => setOpen((v) => !v)}
          onMarkAllRead={markAllRead}
          loadError={notifError}
          panelStyle={{ position: 'fixed', top: 'calc(12px + env(safe-area-inset-top))', insetInlineStart: 'calc(var(--rail-w) + 8px)', insetInlineEnd: 'auto' }}
        />
        <Link href={messagesHref} aria-label={t('kop.berichten')} title={t('kop.berichten')} className="pressable" style={CONTROL}>
          <span className="material-symbols-outlined" style={{ fontSize: 22, color: M3.onSurfaceVariant }} aria-hidden>forum</span>
          {unreadMessages > 0 && <span style={BADGE}>{unreadMessages > 9 ? '9+' : unreadMessages}</span>}
        </Link>
        <Link href="/dashboard/settings" aria-label={t('kop.instellingen')} title={t('kop.instellingen')} className="pressable" style={CONTROL}>
          <span className="material-symbols-outlined" style={{ fontSize: 22, color: M3.onSurfaceVariant }} aria-hidden>settings</span>
        </Link>
        <button type="button" onClick={() => void logout()} aria-label={t('kop.uitloggen')} title={t('kop.uitloggen')} className="pressable" style={CONTROL}>
          <span className="material-symbols-outlined" style={{ fontSize: 22, color: M3.error }} aria-hidden>logout</span>
        </button>
      </div>
    </div>
  )
}
