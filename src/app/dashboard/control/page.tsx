// src/app/dashboard/control/page.tsx
// [CONTROL] De commerciële console: wie er is, wat ze hebben, en waarom.
//
// ── WAT DIT WEL EN NIET IS ──
// Het LEEST. Er zit geen enkele knop op die iets verandert, en dat is voor nu de hele bedoeling:
// eerst zien wat er is, dan pas beslissen welke handelingen er echt nodig zijn. Een console die
// begint met knoppen krijgt de knoppen die iemand zich voorstelde, niet die hij nodig bleek te
// hebben.
//
// En hij raakt de boekhouding niet aan — niet nu en niet later. [GEEN-ACHTERDEUR] faalt de build
// als er ooit een schrijfactie op facturen, boekingen, btw of bankregels vanaf deze kant komt.
// Een vergissing in een abonnement is een mailtje; een met de hand aangepaste factuur is een
// vervalste administratie zonder correctiespoor.
//
// ── WIE HEM ZIET ──
// Alleen de user-id's in CONTROL_USER_IDS. Niet een rol in de database: `profiles.role` kies je
// zelf bij het aanmelden, en "zie elk account in het product" hoort niet bereikbaar te zijn door
// een woord in je eigen rij te zetten. Leeg of niet gezet betekent NIEMAND, en dan bestaat deze
// pagina niet — notFound(), geen inlogscherm, geen hint dat er iets te zoeken valt.

import { notFound } from 'next/navigation'

import { getSessionUser } from '@/lib/session-user'
import { createPipelineClient } from '@/lib/supabase-pipeline'
import { mayOpenControl } from '@/lib/control-access'
import { buildControlOverview, type ControlAccount } from '@/lib/control-overview'
import type { ControlGrantRow } from '@/lib/control-overview'
import { fetchAllRows } from '@/lib/supabase-paginate'
import ControlScherm from './ControlScherm'

export const dynamic = 'force-dynamic'

/**
 * The clock, read once outside the render — same shape as readClock() in /dashboard/klanten:
 * `Date.now()` in a component body is impure, also in a server component, and the React compiler
 * says so with an error rather than a warning.
 */
function readClock(): number {
  return new Date().getTime()
}

type ProfielRij = {
  id: string; company_name: string | null; full_name: string | null; email: string | null
  role: string | null; created_at: string | null
  subscription_status?: string | null; current_period_end?: string | null
}

export default async function ControlPage() {
  const user = await getSessionUser()
  if (!mayOpenControl(user?.id, process.env.CONTROL_USER_IDS)) notFound()

  const pipeline = createPipelineClient()

  // [DEPLOY-SAFE] De abonnementskolommen en plan_grants komen uit met de hand toegepaste
  // migraties. Ontbreken ze, dan valt de lezing terug en toont het scherm wat het wél weet —
  // een console die crasht omdat één kolom er nog niet is, is geen console.
  let profielen: ProfielRij[] = []
  try {
    profielen = await fetchAllRows<ProfielRij>((lo, hi) =>
      // De abonnementskolommen staan niet in de gegenereerde typen (billing_subscription.sql is
      // met de hand toegepast) → ontspannen client, net als in fair-use-gate.ts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (pipeline as any)
        .from('profiles')
        .select('id, company_name, full_name, email, role, created_at, subscription_status, current_period_end')
        .order('id', { ascending: true })
        .range(lo, hi),
    )
  } catch {
    profielen = await fetchAllRows<ProfielRij>((lo, hi) =>
      pipeline
        .from('profiles')
        .select('id, company_name, full_name, email, role, created_at')
        .order('id', { ascending: true })
        .range(lo, hi),
    ).catch(() => [])
  }

  const grantsPerUser = new Map<string, ControlGrantRow[]>()
  let grantsLeesbaar = true
  try {
    // [TOEKENNING-DEUR] `id` rides along: it is what a withdrawal names. Without it the console
    // can show that a pilot is running and offer no way to stop it.
    const alle = await fetchAllRows<{ user_id: string } & ControlGrantRow>((lo, hi) =>
      pipeline
        .from('plan_grants')
        .select('id, user_id, plan, starts_at, expires_at, revoked_at, reason')
        .order('user_id', { ascending: true })
        .range(lo, hi),
    )
    for (const g of alle) {
      const lijst = grantsPerUser.get(g.user_id)
      if (lijst) lijst.push(g)
      else grantsPerUser.set(g.user_id, [g])
    }
  } catch {
    grantsLeesbaar = false
  }

  const accounts: ControlAccount[] = profielen.map((p) => ({
    id: p.id,
    name: p.company_name || p.full_name || p.email || '',
    role: p.role,
    createdAt: p.created_at,
    subscriptionStatus: p.subscription_status ?? null,
    currentPeriodEnd: p.current_period_end ?? null,
    grants: grantsPerUser.get(p.id) ?? [],
  }))

  const overzicht = buildControlOverview(accounts, readClock())

  return <ControlScherm overzicht={overzicht} grantsLeesbaar={grantsLeesbaar} />
}
