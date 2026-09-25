'use client'

// src/app/dashboard/werkplek/WerkplekClient.tsx
// [BOEK-029] Material You design — BoekBrug Design System v1.0 — May 2026
// [CONTROL] UI extracted from page.tsx so page.tsx can server-guard the role.

import { useRouter } from 'next/navigation'
// [DESIGN] Palette and radius come from the shared source now
// (src/lib/design/tokens.ts). This file used to declare its own copy; see the
// header of tokens.ts for why the copies had to go — two of the values in them
// were below the contrast floor for text.
import { M3, COLUMN } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'

const FONT = "'Roboto', -apple-system, sans-serif"
const R    = { md: 12, lg: 16, xl: 24 }
const EL1  = '0 1px 2px rgba(0,0,0,0.08)'

// [TAAL] Copy lives in the catalogue; this table keeps only the keys plus the visuals.
const ITEMS = [
  { icon: 'receipt_long', labelKey: 'wp.facturen',  subKey: 'wp.facturen.sub',  href: '/dashboard/facturen', bg: M3.primary,   color: '#fff' },
  { icon: 'folder_open',  labelKey: 'best.mijn',    subKey: 'wp.bestanden.sub', href: '/dashboard/bestanden', bg: M3.warning,   color: '#fff' },
  // [COHERENCE-ORPHAN] De Brug — the app's namesake invoice↔document tree — had no ZZP
  // entry point (only accountant surfaces linked to it), so the owner could never open it.
  { icon: 'account_tree', labelKey: 'wp.brug',      subKey: 'wp.brug.sub',      href: '/dashboard/brug', bg: '#1967D2', color: '#fff' },
  { icon: 'people',       labelKey: 'wp.klanten',   subKey: 'wp.klanten.sub',   href: '/dashboard/klanten',  bg: M3.success,   color: '#fff' },
  { icon: 'shield',       labelKey: 'wp.kluis',     subKey: 'wp.kluis.sub',     href: '/dashboard/kluis', bg: '#455A64', color: '#fff' },
  { icon: 'settings',     labelKey: 'wp.gegevens',  subKey: 'wp.gegevens.sub',  href: '/dashboard/settings', bg: M3.tertiary,  color: '#fff' },
  // [LOGBOEK] The trail 60 files write and no screen ever showed. It belongs on THIS hub and not
  // in the bottom bar: that bar carries four or five destinations per role on purpose (see its header) and
  // defers everything else to the home tiles — and a log is something you consult after the fact,
  // not a place you work from. Owner-only by construction: page.tsx above redirects an accountant
  // to their own home before this list renders, so no entry has to gate itself.
  // `history` is in the icon_names subset in layout.tsx; a name outside it renders as raw ligature
  // text (see material-icons.test.ts).
  { icon: 'history',      labelKey: 'log.titel',    subKey: 'log.uitleg',       href: '/dashboard/logboek',  bg: '#5F6368',    color: '#fff' },
  // [BEVEILIGING] Wie er bij deze administratie kan, hoe hij op slot zit, en wat er is vastgelegd.
  // Op deze hub en niet weggestopt in Instellingen: het is geen instelling die je één keer zet en
  // vergeet maar een antwoord dat je komt HALEN — en een antwoord dat drie schermen diep ligt, is
  // er geen. 'lock' is daarvoor aan de icon_names-subset in layout.tsx toegevoegd; een naam
  // daarbuiten valt terug op de kale tekst (zie material-icons.test.ts).
  { icon: 'lock',         labelKey: 'bev.titel',    subKey: 'bev.uitleg',       href: '/dashboard/beveiliging', bg: '#0B57D0', color: '#fff' },
] as const

export default function WerkplekClient() {
  const t = translator(useLocale())
  const router = useRouter()

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FA', fontFamily: FONT, WebkitFontSmoothing: 'antialiased' }}>

      <main style={{ maxWidth: COLUMN.hub, margin: '0 auto', padding: '20px 16px 80px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ITEMS.map(item => (
            <button
              key={item.href}
              onClick={() => router.push(item.href)}
              style={{
                display: 'flex', alignItems: 'center', gap: 16,
                background: '#fff', borderRadius: R.lg, padding: '18px 16px',
                border: 'none', boxShadow: EL1,
                cursor: 'pointer', textAlign: 'start', width: '100%',
                transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <div style={{
                width: 50, height: 50, borderRadius: R.md,
                background: item.bg, display: 'flex', alignItems: 'center',
                justifyContent: 'center', flexShrink: 0,
              }}>
                <span className="material-symbols-outlined" style={{ color: item.color, fontSize: 26 }} aria-hidden>{item.icon}</span>
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 16, fontWeight: 600, color: M3.onSurface, marginBottom: 2 }}>{t(item.labelKey)}</p>
                <p style={{ fontSize: 13, color: '#5F6368' }}>{t(item.subKey)}</p>
              </div>
              <span className="material-symbols-outlined icon-dir" style={{ color: '#80868b', fontSize: 20 }} aria-hidden>chevron_right</span>
            </button>
          ))}
        </div>
      </main>

      {/* [BOEK-029] FAB — + Nieuwe factuur — Material You */}
      <button
        onClick={() => router.push('/dashboard/invoice/new')}
        style={{
          position: 'fixed',
          bottom: 'calc(24px + var(--bottom-nav-h) + env(safe-area-inset-bottom))',
          insetInlineEnd: 20,
          background: '#D3E3FD', color: '#041E49',
          borderRadius: 16, padding: '16px 20px',
          fontSize: 15, fontWeight: 600,
          border: 'none', cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.16)',
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: "'Roboto', sans-serif", zIndex: 50,
          transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }} aria-hidden>add</span>
        {t('lijst.nieuw')}
      </button>
    </div>
  )
}
