// src/app/dashboard/page.tsx
// [INTEGRATION] role-based entry routing — May 2026

import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/session-user'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'
import { worksOnVehicles } from '@/lib/vak-profile'
import { workSkin } from '@/lib/werk'
// [PROFILE-READ] A failed read is not a missing row — see the header of src/lib/profile-read.ts.
import { classifyProfileRead } from '@/lib/profile-read'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient()

  // [WATERVAL] Memoised per request (session-user.ts) — the dashboard layout above already asked.
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // Alleen wat dit scherm gebruikt. Hier stond `select('*')`, en die rij ging vervolgens als
  // prop naar een client component — dus élke kolom van profiles kwam in de RSC-payload in de
  // browser terecht: subscription_stripe_id, iban, kvk_number, btw_number, phone, address.
  //
  // Het zijn de eigen gegevens van de gebruiker, dus er lekt niets naar een ander. Maar de
  // home heeft er vier nodig (naam, bedrijfsnaam, e-mail, id) plus twee om te kunnen routeren,
  // en een `*` groeit stil mee met elke kolom die iemand later toevoegt — inclusief een die er
  // niet hoort te staan. De header werkte allang met precies deze smalle vorm.
  const profileRead = classifyProfileRead(
    await supabase
      .from('profiles')
      .select('id, full_name, company_name, email, role, onboarding_done')
      .eq('id', user.id)
      .maybeSingle(),
  )

  // [PROFILE-READ] A read that FAILED is not a profile that is missing. This used to send both to
  // /onboarding, so one refused or timed-out read walked a completed owner back into the wizard —
  // where a second null then INSERTED a fresh step-1 profile on top of the one that exists. The
  // honest answer to "we could not look" is the error boundary beside this page (error.tsx: "Er
  // ging iets mis", with a retry that re-runs this read), never a redirect that claims to know.
  if (profileRead.kind === 'failed') {
    console.error('[PROFILE-READ] profile unreadable on the home — refusing to route', {
      userId: user.id,
      code: profileRead.code,
      error: profileRead.message,
    })
    throw new Error('[PROFILE-READ] profile unreadable')
  }

  // [INTEGRATION] genuinely no profile, or incomplete onboarding → /onboarding — May 2026
  if (profileRead.kind === 'missing') redirect('/onboarding')
  const profile = profileRead.row
  if (!profile.onboarding_done) redirect('/onboarding')

  // [INTEGRATION] accountant → accountant hub — May 2026
  if (profile.role === 'accountant') redirect('/dashboard/accountant')

  // [VOERTUIG] Does this owner work on cars? Decides whether the home offers a vehicle register at
  // all — a barber must never be shown one.
  //
  // ⚠️ Read APART from the select above, and deliberately narrow: the comment on that select warns
  // that `*` grows silently with every column someone later adds, and adding `vak` to it would ALSO
  // fail the whole read on a deployment where profile_vak.sql has not been applied by hand — and a
  // null profile here does not degrade a tile, it redirects the owner to /onboarding. A home-screen
  // nicety must never be able to send someone back through the wizard.
  let vehicleTrade = false
  // [WERK] The trade's own plural for the home tile ('Werkorders', 'Ritten', …); null = no tile.
  let workPluralKey: string | null = null
  try {
    const { data: vakRow } = await supabase
      .from('profiles').select('vak').eq('id', user.id).maybeSingle()
    vehicleTrade = worksOnVehicles((vakRow as { vak?: string | null } | null)?.vak)
    workPluralKey = workSkin((vakRow as { vak?: string | null } | null)?.vak)?.pluralKey ?? null
  } catch {
    /* no column yet → no vehicle tile, exactly as before */
  }

  // ZZP → existing DashboardClient (unchanged)
  return <DashboardClient profile={profile} vehicleTrade={vehicleTrade} workPluralKey={workPluralKey} />
}