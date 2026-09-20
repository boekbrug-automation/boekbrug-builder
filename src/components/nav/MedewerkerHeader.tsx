'use client'

// src/components/nav/MedewerkerHeader.tsx
// [MEDEWERKER] De kop van het verkoopbord — de enige plek waar deze gebruiker een bel en een
// uitlogknop kan krijgen.
//
// ── WAAROM DIT ER NIET WAS, EN WAAROM DAT ERGER WAS DAN HET LEEK ──
//
// De dashboard-layout verbergt voor een verkoopmedewerker de hele navigatie, met een goed argument
// dat er in zoveel woorden staat: zijn links werpen hem terug, en een menu vol doodlopende wegen
// laat de app kapot lijken terwijl ze precies doet wat ze moet doen. Alleen kwam er niets voor in
// de plaats. Het gevolg is een gebruiker die in een applicatie werkt zonder uitlogknop — op een
// gedeelde balie-computer is dat niet ongemak maar een openstaande sessie op andermans
// administratie.
//
// En de bel is scherper dan dat. Als het versturen van een factuur mislukt, schrijft
// api/invoice/send een melding naar de MEDEWERKER met een link naar zijn eigen bord — die code is
// er, is bewust geschreven, en werkt. De bel die zulke meldingen toont woont in DashboardHeader,
// en die rendert alleen op de twee home-schermen: precies de twee schermen die hij nooit mag zien.
// De melding kwam dus aan op een plek waar hij per definitie niet kon kijken. Het bericht "je
// factuur is NIET verstuurd" bereikte de enige persoon die er iets aan kon doen nooit.
//
// ── WAT HIJ HIER WEL EN NIET KRIJGT ──
//
// Wel: zijn naam, zijn bel, uitloggen, en de twee schermen die hij mag openen maar waar geen enkele
// deur heen wees (Klanten en Beveiliging — zie SALES_SCREENS in acting-for.ts, waar het argument
// voor dat laatste staat: hij factureert in de doorlopende nummerreeks van de eigenaar, dus zijn
// wachtwoord is net zoveel waard als dat van de eigenaar).
//
// Niet: de zoekbalk en de onderbalk. Díe blijven verborgen, om de oorspronkelijke reden — het zijn
// menu's naar schermen die niet van hem zijn.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { createClient } from '@/lib/supabase'
import { M3, FONT, PAGE_HEADER_HEIGHT } from '@/lib/design/tokens'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import type { NotificationRow } from '@/types/rows'
import { NotificationsBell, ProfileMenu, type HeaderProfile } from '@/app/dashboard/_shared'
import { useToast } from '@/components/ui/Toast'

export function MedewerkerHeader({ profile }: { profile: HeaderProfile }) {
  const t = translator(useLocale())
  const router = useRouter()
  const showToast = useToast()
  const supabase = createClient()

  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  // [NO-SILENT-EMPTY] Een mislukte lezing mag hier nooit als "Geen meldingen" verschijnen. Op deze
  // bel komt "je factuur is niet verstuurd" binnen; dat is de duurste zin om te verzwijgen.
  const [notifError, setNotifError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let actief = true
    ;(async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(20)
      if (!actief) return
      if (error) { setNotifError(t('start.meldingenFout')); return }
      setNotifError(null)
      setNotifications(data ?? [])
    })()
    return () => { actief = false }
    // De supabase-client is stabiel per render; alleen de gebruiker telt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  async function markAllRead(): Promise<boolean> {
    const ongelezen = notifications.filter((n) => !n.read).map((n) => n.id)
    if (ongelezen.length === 0) return true
    const { error } = await supabase.from('notifications').update({ read: true }).in('id', ongelezen)
    // Het scherm mag pas "gelezen" tonen als het ook echt is opgeslagen — zelfde regel als op de
    // home van de eigenaar. [MELDING-WAARHEID] The outcome is returned: the bell takes its local
    // mark back on a false.
    if (error) {
      console.error('[MEDEWERKER] meldingen als gelezen markeren mislukt:', error.message)
      return false
    }
    setNotifications((vorige) => vorige.map((n) => ({ ...n, read: true })))
    return true
  }

  async function logout() {
    // [UITLOGGEN] signOut() keeps the local session when the server refused, so navigating to
    // /login as if it worked only bounced the member straight back, with no word. Say it, and stay
    // signed in — which is the truth. Same rule as the owner's home bar and the rail.
    const { error } = await supabase.auth.signOut()
    if (error) {
      console.error('[MEDEWERKER] uitloggen mislukt:', error.message)
      showToast(t('kop.uitloggenMislukt'), { tone: 'error' })
      return
    }
    router.push('/login')
  }

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
      // De shorthand blijft BOVEN paddingTop staan: hij zet alle vier de zijden terug, dus
      // andersom zou de safe-area-inset weer verdwijnen. Zelfde volgorde als DashboardHeader.
      padding: '0 16px',
      paddingTop: 'env(safe-area-inset-top)',
      gap: 8,
      fontFamily: FONT,
    }}>
      <Link
        href="/dashboard/verkoop"
        style={{
          fontWeight: 700, fontSize: 17, color: M3.primary,
          flexShrink: 0, letterSpacing: '-0.3px', lineHeight: 1,
          textDecoration: 'none', fontFamily: FONT,
        }}
      >
        BoekBrug
      </Link>

      <div style={{ flex: 1, minWidth: 0 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
        <NotificationsBell
          notifications={notifications}
          showNotifications={open}
          onToggle={() => setOpen((v) => !v)}
          onMarkAllRead={markAllRead}
          loadError={notifError}
        />
        {/* [MEDEWERKER] Niet Instellingen: dat scherm staat niet in SALES_SCREENS. Wel de twee
            schermen die hij wél mag openen en waar tot nu toe geen enkele link heen wees. */}
        <ProfileMenu
          profile={profile}
          onLogout={logout}
          links={[
            { label: t('kop.mijnKlanten'), href: '/dashboard/klanten', icon: 'group' },
            { label: t('kop.beveiliging'), href: '/dashboard/beveiliging', icon: 'lock' },
          ]}
        />
      </div>
    </header>
  )
}
