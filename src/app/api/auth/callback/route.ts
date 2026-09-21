// src/app/api/auth/callback/route.ts
// [Google-OAuth] OAuth callback — exchange code for session, route user correctly
//
// IMPORTANT: Supabase Redirect URL must be set to:
//   https://boekbrug.nl/api/auth/callback
// NOT https://boekbrug.nl/ — that causes the code to land on the homepage unused.

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { ROLE_PARAM } from '@/lib/register-intent'
import { PURPOSE_PARAM } from '@/lib/account-purpose'
import { planAfterOAuth } from '@/lib/auth-landing'
// [PROFILE-READ] A failed read is not a missing row — see the header of src/lib/profile-read.ts.
import { classifyProfileRead } from '@/lib/profile-read'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')

  // [Google-OAuth] No code = something went wrong upstream
  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', req.url))
  }

  const supabase = await createServerSupabaseClient()

  // [Google-OAuth] Exchange code for session — this is the critical step
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  // [Google-OAuth] Fallback: getUser if data.user came back null
  const user = data?.user ?? (await supabase.auth.getUser()).data.user

  if (error || !user) {
    console.error('[Google-OAuth] exchangeCodeForSession failed:', error?.message)
    return NextResponse.redirect(new URL('/login?error=auth_failed', req.url))
  }

  // [AUTH-FRONTDOOR] The only metadata we carry is the display name — from the
  // email signup (register/page.tsx passes data.full_name) or from Google.
  const metaName = user.user_metadata?.full_name || user.user_metadata?.name || ''

  // [PROFILE-READ] Three answers to "does this user already have a profile?", kept apart.
  //
  // This was `const { data: existingProfile } = await … .single()`, and `data` alone. supabase-js
  // never throws, so a read that FAILED came back as the same null as a row that is MISSING — and
  // this route acts on "missing" by UPSERTING a profile. One refused or timed-out read therefore
  // wrote role / onboarding_step / onboarding_done / full_name over a row that already existed.
  // The worst shape of it: a finished accountant signing in with Google carries no ?rol=, so the
  // plan fell back to 'zzper' — demoted to a ZZP'er, onboarding_done back to false, and pushed
  // into the wizard, with nothing on any screen to say why.
  //
  // The middleware, /dashboard and /onboarding were converted to this classifier for exactly that
  // bug; this route was the fourth reader and was missed. `.maybeSingle()` rather than `.single()`
  // for the same reason: it answers "no row" with no error at all, so the error channel carries
  // only real failures instead of one magic code standing between them.
  const profileRead = classifyProfileRead(
    await supabase
      .from('profiles')
      .select('id, onboarding_done, onboarding_step, full_name, role')
      .eq('id', user.id)
      .maybeSingle(),
  )

  if (profileRead.kind === 'failed') {
    // Loud, because from the visitor's side this is indistinguishable from an ordinary sign-in:
    // they land on the home and everything looks normal. Nothing else will ever report it.
    console.error('[PROFILE-READ] profile unreadable in the OAuth callback — writing nothing', {
      userId: user.id,
      code: profileRead.code,
      error: profileRead.message,
    })
  }

  // Wat er moet gebeuren, in één keer beslist. De vier beslissingen die hier stonden — bestaat
  // er al een profiel, welke rol schrijven we, is dit een archiefaccount, waar gaat hij heen —
  // stonden verweven met de databaseaanroepen, en juist die verwevenheid verborg de fout: de
  // regel "stuur elke nieuwe gebruiker naar /onboarding" stond vóór de regel die naar de kluis
  // wees en won dus altijd. Zie src/lib/auth-landing.ts; het staat daar met tests erbij.
  const plan = planAfterOAuth(
    {
      next: searchParams.get('next'),
      role: searchParams.get(ROLE_PARAM),
      purpose: searchParams.get(PURPOSE_PARAM),
    },
    profileRead,
  )

  if (plan.profileToCreate) {
    // [BOEK-015] fix: use UPSERT — the on_auth_user_created trigger may have
    // already created a profile row. INSERT would 23505 and leave the user
    // stuck. onboarding_step: 1 (not 0) so the wizard renders Step 1.
    await supabase.from('profiles').upsert({
      id: user.id,
      full_name: metaName,
      email: user.email || '',
      ...plan.profileToCreate,
    }, { onConflict: 'id' })
  } else if (plan.backfillName && metaName) {
    // [BOEK-015] The trigger creates a bare profile (email only). Backfill the name
    // from metadata on first sign-in, but only if it is still empty — never overwrite
    // a name the user has since edited.
    //
    // [PROFILE-READ] `plan.backfillName` is what moved: this used to be a bare `else if
    // (metaName)`, the one write that sat outside the plan — so a plan that ordered nothing
    // still left this one standing on a read that failed. Every write in this route is now
    // plan-driven, which is also what lets the tests assert "this plan orders no write" once
    // instead of four times.
    await supabase
      .from('profiles')
      .update({ full_name: metaName })
      .eq('id', user.id)
      .is('full_name', null)
  }

  // [OAUTH-ROL] De rolkeuze uit stap 1 van /register, op een profiel dat de trigger zojuist zelf
  // heeft aangemaakt. Bij Google is dat de gewone gang van zaken: on_auth_user_created vuurt
  // tijdens exchangeCodeForSession, dus tegen de tijd dat wij hierboven kijken bestaat de rij al
  // — kaal, want een OAuth-aanmelding draagt geen signUp-metadata. Zonder deze regels zou de
  // rolkeuze alsnog in die kale rij verdwijnen, en dat is wat er gebeurde.
  if (plan.roleUpdate) {
    await supabase
      .from('profiles')
      .update({ role: plan.roleUpdate })
      .eq('id', user.id)
  }

  // [KLUIS] En dit is waar het archiefpad tot nu toe strandde. Wie via /bewaarplicht met Google
  // binnenkwam werd onvoorwaardelijk de wizard in gestuurd — over facturen versturen,
  // bedrijfsgegevens en het koppelen van een mailbox, en hij kwam voor geen van drieën. Het
  // zelfherstel op /dashboard/kluis dat dit hoorde op te vangen kon dat niet: dat vuurt pas als
  // iemand DAAR aankomt met ?doel=archief, en daar kwam hij nooit.
  if (plan.markArchief) {
    await markArchief(supabase, user.id)
  }

  // De bestemming: de kluis voor een archiefaccount, de wizard voor wie hem nog moet doorlopen,
  // en anders `next` — dat laatste [SEC-REDIRECT] gecontroleerd op een pad binnen onze origin.
  //
  // NOTE: Gmail connection is intentionally NOT handled here.
  // OAuth tokens are stored ENCRYPTED in Vault by /api/email/callback/gmail
  // (BOEK-011 + BOEK-SECURITY) via saveEmailTokens(), which writes the
  // *_secret_id reference columns. The previous code here upserted raw
  // access_token/refresh_token into email_connections, but those plaintext
  // columns no longer exist (replaced by Vault refs), so the write failed
  // silently and broke the type check after types were regenerated.
  // Gmail linking is a deliberate user action via the "Connect Gmail" flow.
  return NextResponse.redirect(new URL(plan.destination, req.url))
}

/**
 * [KLUIS] Leg vast dat dit een archiefaccount is: geen wizard, en de kluis als eerste pagina.
 *
 * TWEE aparte schrijfacties, en dat is de hele reden dat deze functie bestaat.
 * `account_purpose` komt uit account_purpose_archief.sql. In productie staat die migratie
 * (gemeten op 31 juli 2026, met de query onderaan docs/WELKE_MIGRATIES_STAAN_ER.sql) — maar een
 * verse dev- of stagingdatabase begint zonder. Zit die kolom er niet, dan weigert PostgREST de
 * HELE rij (PGRST204), dus in één update zou ook `onboarding_done` niet geschreven worden en
 * stond de bezoeker alsnog in de wizard waar hij niet hoort.
 *
 * Daarom eerst de kolom die er altijd is. Ontbreekt de tweede, dan mist de bezoeker een andere
 * begroeting op zijn kluis — niet de kluis zelf. En de bestemming draagt ?doel=archief mee, dus
 * het zelfherstel op /dashboard/kluis krijgt daarna alsnog zijn kans.
 *
 * Best effort: een mislukte schrijfactie mag de aanmelding nooit tegenhouden. De gebruiker is
 * op dit punt ingelogd; hem hier laten stranden zou een slechtere uitkomst zijn dan een
 * verkeerde begroeting.
 */
async function markArchief(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
): Promise<void> {
  const { error: doneError } = await supabase
    .from('profiles')
    .update({ onboarding_done: true })
    .eq('id', userId)
  if (doneError) {
    console.error('[KLUIS] onboarding_done niet gezet na Google-registratie:', doneError.message)
  }

  const { error: purposeError } = await supabase
    .from('profiles')
    .update({ account_purpose: 'archief' })
    .eq('id', userId)
  if (purposeError) {
    // Verwacht zolang account_purpose_archief.sql niet is toegepast — geen reden tot alarm,
    // wel iets om te kunnen zien. Zie docs/MIGRATIES_VOLGORDE.md.
    console.error('[KLUIS] account_purpose niet gezet (migratie toegepast?):', purposeError.message)
  }
}