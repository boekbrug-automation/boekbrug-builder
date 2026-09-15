// src/app/dashboard/accountant/gids/page.tsx
// [KANTOORGIDS] Dezelfde rolwacht als elke boekhouderspagina: een ondernemer die de URL raadt
// hoort in zijn eigen dashboard uit te komen, niet in het kantoorformulier van iemand anders.

import { redirect } from 'next/navigation'

import { createServerSupabaseClient } from '@/lib/supabase-server'
import { getSessionUser } from '@/lib/session-user'
import KantoorgidsPaneel from '@/modules/accountant/pages/KantoorgidsPaneel'

export const dynamic = 'force-dynamic'

export default async function KantoorgidsPage() {
  const supabase = await createServerSupabaseClient()
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, onboarding_done')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.onboarding_done) redirect('/onboarding')
  if (profile.role !== 'accountant') redirect('/dashboard')

  return <KantoorgidsPaneel />
}
