'use client'

// src/app/register/page.tsx
// [Google-OAuth] Add Google OAuth registration — May 2026

import { Suspense, useState, useEffect } from 'react'
import { getBrowserClient } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import { ErrorMessage } from '@/components/ui/Feedback'
// [TAAL-POORT] Dit scherm was 100% Nederlands — nul catalogus-imports — terwijl het de landing is
// van 56 Arabische blogartikelen. Zie AuthLanguageSwitch voor de andere helft van die reparatie.
import { AuthLanguageSwitch } from '@/components/i18n/AuthLanguageSwitch'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import type { MessageKey } from '@/lib/i18n/messages'
// [FUNNEL-OVERDRACHT] Zeggen dat de factuur uit de gratis generator bewaard is — zie hieronder.
import { readHandoff, hasInvoiceContent } from '@/lib/factuur-handoff'
import { isSafeRedirect, safeRedirect } from '@/lib/safe-redirect'
import { ROLE_PARAM, parseRole } from '@/lib/register-intent'
import { EMAIL_REGEX } from '@/lib/validation'
import { VAK_PARAM, parseVak } from '@/lib/vak-profile'
import { trackFunnel, FUNNEL_EVENTS } from '@/lib/funnel-events'
import { readAttribution } from '@/lib/campaign-attribution'
import {
  PURPOSE_PARAM,
  landingPath,
  parsePurpose,
  purposeCopy,
  ARCHIEF_ROLE,
} from '@/lib/account-purpose'


function RegisterContent() {
  const searchParams = useSearchParams()

  // [KLUIS] Een archiefaccount kent geen rolkeuze: het is een ondernemer met een eigen
  // administratie, punt. Daarom begint dat pad meteen bij stap 2 en staat de rol vast.
  // (De initialisatie leest de querystring rechtstreeks in plaats van via `purpose`, omdat
  // useState hier draait vóór de regel die `purpose` berekent.)
  const isArchief = searchParams.get(PURPOSE_PARAM) === 'archief'

  // [KANTOOR-VOORDEUR] /voor-boekhouders stuurt hierheen met ?rol=accountant. Wie binnenkomt van
  // een pagina die over niets anders gaat dan boekhouders, heeft de vraag "wie ben jij" al
  // beantwoord door erop te klikken; hem die opnieuw stellen leest als niet opgelet hebben.
  //
  // De waarde gaat door parseRole en niet rechtstreeks de state in, want een querystring is
  // invoer: alles behalve 'zzper' of 'accountant' telt als niets gekozen en levert gewoon stap 1
  // op. Het is dezelfde toets die de OAuth-callback doet, om dezelfde reden.
  //
  // Het slaat stap 1 alleen OVER — de terugknop brengt hem er alsnog heen, want een rol is een
  // zelfverklaring en de bezoeker mag hem veranderen.
  const voorafGekozenRol = parseRole(searchParams.get(ROLE_PARAM))

  // [UITNODIGING] Een uitnodigingslink weet op welk adres de uitnodiging is verstuurd, en de
  // acceptatie weigert elk ander adres (403, met de remedie erbij). Het adres NIET voorinvullen
  // maakte "een ander adres typen" dus de standaardfout in plaats van een randgeval. Voorvullen,
  // niet vastzetten: het veld blijft gewoon bewerkbaar — wie een ander adres wil, kiest dat dan
  // wetend, en krijgt bij de acceptatie de eerlijke weigering die daarbij hoort.
  const voorafEmail = searchParams.get('email')

  const [step, setStep] = useState(isArchief || voorafGekozenRol ? 2 : 1)
  const [role, setRole] = useState(isArchief ? ARCHIEF_ROLE : (voorafGekozenRol ?? ''))
  const [email, setEmail] = useState(voorafEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(voorafEmail) ? voorafEmail : '')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [kvk, setKvk] = useState('')
  const [btw, setBtw] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  // [TAAL] Sleutels, geen zinnen — zie de veldcontrole in handleRegister.
  const [error, setError] = useState<MessageKey | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ name?: MessageKey; email?: MessageKey; password?: MessageKey }>({})
  const [emailTaken, setEmailTaken] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  // [FUNNEL-OVERDRACHT] Staat er een factuur klaar uit de gratis generator? Alleen om het te
  // kunnen zeggen op het bevestigingsscherm — dit leest, verwijdert niet: het formulier in het
  // dashboard biedt de factuur straks pas echt aan.
  const [factuurKlaar, setFactuurKlaar] = useState(false)
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (hasInvoiceContent(readHandoff(localStorage))) setFactuurKlaar(true)
    } catch {
      /* geblokkeerde opslag — dan zeggen we gewoon niets */
    }
  }, [])
  const router = useRouter()

  // [KLUIS] Waarvoor deze bezoeker komt. /bewaarplicht stuurt hier naartoe met ?doel=archief:
  // iemand wiens zaak gestopt is komt zijn administratie WEGZETTEN, niet boekhouden. Hij
  // krijgt daarom andere teksten, geen rolkeuze (hij is gewoon een ondernemer) en na
  // registratie zijn kluis in plaats van een wizard over facturen versturen.
  const purpose = parsePurpose(searchParams.get(PURPOSE_PARAM))
  // [VAK-BRUG] Het vak waarmee de bezoeker binnenkwam. /factuur-maken/<vak> is een publieke
  // landingspagina waar hij zijn beroep al KOOS — en tot nu toe raakte dat kwijt op het moment
  // dat hij een account maakte, precies wanneer het het meest waard is: zijn prijslijst begint
  // leeg en de Kassa opent op "je prijslijst is nog leeg". Onbekend → null, en dat is de normale
  // toestand van elk bestaand account. Zie vak-profile.ts.
  const vakUitUrl = parseVak(searchParams.get(VAK_PARAM))

  // [VAK-BRUG] De querystring is de eerste bron, niet de enige. Wie de CTA overslaat, of wie zijn
  // bevestigingsmail in een ander tabblad opent, komt hier zonder ?vak= binnen terwijl hij zijn
  // beroep wél gekozen had — dan staat het nog in de overdracht. parseVak() opnieuw, want wat uit
  // opslag komt is net zo min te vertrouwen als wat uit een URL komt.
  const [vakUitOverdracht, setVakUitOverdracht] = useState<string | null>(null)
  useEffect(() => {
    if (vakUitUrl) return
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVakUitOverdracht(parseVak(readHandoff(localStorage)?.vak))
    } catch {
      /* geblokkeerde opslag — dan blijft het vak onbekend, en dat is de normale toestand */
    }
  }, [vakUitUrl])

  const vak = vakUitUrl ?? vakUitOverdracht

  /**
   * [HERKOMST] De campagne van dit bezoek, als er een was. Gelezen bij het event en niet in state
   * gezet: dit is nooit iets dat het scherm laat zien, alleen iets dat de meting vergezelt.
   */
  function campagne(): { source?: string; medium?: string; campaign?: string } {
    try {
      const h = readAttribution(localStorage)
      return h ? { source: h.source, medium: h.medium, campaign: h.campaign } : {}
    } catch {
      return {}
    }
  }
  const copy = purposeCopy(purpose)
  const t = translator(useLocale())

  // Welke stap er te zien is. Op het archiefpad is dat altijd stap 2, wat er ook in `step`
  // staat — die bezoeker heeft geen rolkeuze, dus stap 1 wordt niet gerenderd.
  //
  // Afgeleid en niet uit de state gelezen, want anders is "geen enkele stap" een mogelijke
  // uitkomst: stap 1 rendert niet op het archiefpad, stap 2 rendert niet bij step === 1, en dan
  // blijft er een kaart over met alleen de kop erin. Geen foutmelding, geen weg terug, alleen
  // opnieuw laden — en dan is alles wat er ingevuld stond weg. Zo lag het, en het kostte één
  // setStep(1) uit de terugknop om er te komen. Dit maakt die toestand onmogelijk in plaats van
  // onbereikbaar, zodat de volgende setStep(1) hem niet opnieuw opent.
  const zichtbareStap = isArchief ? 2 : step

  // Keep any ?redirect= when we link over to /login.
  // [SEC-REDIRECT] Alleen een bestemming die wij ook zouden honoreren reist mee. Dit was al
  // ongevaarlijk (de link wijst hoe dan ook naar ons eigen /login), maar een waarde doorgeven
  // die de ontvanger straks weggooit is een belofte die je niet waarmaakt.
  const redirectParam = searchParams.get('redirect')
  const loginHref = isSafeRedirect(redirectParam)
    ? `/login?redirect=${encodeURIComponent(redirectParam)}`
    : '/login'

  // De bestemming die de bezoeker zélf meebracht, of null als hij niets vroeg.
  // [SEC-REDIRECT] Wat hij meebracht wordt hier al gecontroleerd, niet pas in de callback: een
  // bestemming die wij niet vertrouwen hoort onze eigen URL niet eens in.
  function gevraagdeBestemming(): string | null {
    const wens = searchParams.get('redirect')
    if (isSafeRedirect(wens)) return wens
    // [KLUIS] Geen ?redirect=, maar wel een archiefaccount: dan is de kluis de bestemming, mét
    // ?doel=archief zodat het zelfherstel daar kan vuren als de kolom nog niet bestaat.
    return purpose === 'archief' ? `${landingPath(purpose)}?${PURPOSE_PARAM}=archief` : null
  }

  // [BEVESTIGINGSLINK] Waar de link in de bevestigingsmail uitkomt: onze eigen callback, die de
  // code inwisselt voor een sessie. Altijd een concrete bestemming — anders zou de callback voor
  // een archiefaccount alsnog bij zijn standaardgedrag uitkomen.
  function bevestigingsBestemming(): string {
    const callback = new URL('/api/auth/callback', window.location.origin)
    callback.searchParams.set('next', gevraagdeBestemming() ?? landingPath(purpose))
    return callback.toString()
  }

  // Een foutmelding bij een veld verdwijnt zodra dat veld verandert.
  //
  // Ze bleven staan tot de volgende verzendpoging: je kreeg "Vul je naam in", je vulde je naam
  // in, en de rode regel bleef eronder staan alsof er nog iets mis was. Bij een formulier dat je
  // één keer in je leven invult is dat precies het moment waarop iemand denkt dat hij iets fout
  // doet en afhaakt.
  function wisFout(veld: 'name' | 'email' | 'password') {
    setFieldErrors(vorige => (vorige[veld] ? { ...vorige, [veld]: undefined } : vorige))
  }

  // Wie al ingelogd is, hoort hier niet te zijn.
  //
  // /register is een publieke pagina, en elke publieke pagina (de prijzen, de blog, de
  // rekenhulpen) heeft "Gratis account" in de kopbalk staan. Een ingelogde bezoeker die daarop
  // klikt kwam gewoon op dit formulier. Vulde hij het in, dan maakte signUp() een TWEEDE account
  // aan en nam die de sessie over: hij zit dan in een leeg account, en het zijne — met zijn
  // facturen erin — is uit dat tabblad verdwenen. Niets ging kapot, maar niets legde het ook uit.
  //
  // De controle staat in een effect en niet in de render, zodat er tijdens `next build` geen
  // Supabase-client wordt gebouwd. Zie de RULE in src/lib/supabase.ts.
  // Mét zijn bestemming: wie hier komt via /invite/accept?token=… en al is ingelogd, hoort bij
  // die uitnodiging uit te komen en niet op een dashboard waar de uitnodiging nergens meer staat.
  useEffect(() => {
    let afgebroken = false
    getBrowserClient().auth.getSession().then(({ data }) => {
      if (!afgebroken && data.session) router.replace(gevraagdeBestemming() ?? '/dashboard')
    })
    return () => { afgebroken = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  // [Google-OAuth] Reset loading when user returns via browser back button
  useEffect(() => {
    const reset = () => setGoogleLoading(false)
    window.addEventListener('pageshow', reset)
    document.addEventListener('visibilitychange', reset)
    window.addEventListener('focus', reset)
    return () => {
      window.removeEventListener('pageshow', reset)
      document.removeEventListener('visibilitychange', reset)
      window.removeEventListener('focus', reset)
    }
  }, [])

  // [Google-OAuth] Google register/login via Supabase OAuth
  // [OAUTH-ROL] De rolkeuze uit stap 1 reist mee als ?rol= op onze eigen callback-URL, en de
  // callback slaat hem daar op. Hier stond het comment dat dit al gebeurde; het gebeurde niet.
  // Zie src/lib/register-intent.ts voor wat er wel en niet aan zo'n meegereisde waarde vastzit.
  async function handleGoogleRegister() {
    if (!role) {
      // Step 1 not done yet — show role picker first
      setStep(1)
      return
    }

    setGoogleLoading(true)
    setError(null)

    // [Google-OAuth] Auto-reset after 10s in case user cancels or goes back
    const resetTimer = setTimeout(() => setGoogleLoading(false), 10_000)

    // [KLUIS] Via Google gaat de signUp-metadata niet mee — die weg loopt langs Supabase's
    // OAuth-callback en niet langs onze signUp(). Het doel reist daarom mee als ?doel= op die
    // callback, náást de bestemming, en de callback legt het daar vast.
    //
    // Dat het doel alleen in de bestemmings-URL zat was niet genoeg, en dat was niet zichtbaar:
    // de callback stuurde iedere nieuwe gebruiker onvoorwaardelijk naar /onboarding en negeerde
    // die bestemming. Het zelfherstel op /dashboard/kluis waar dit op leunde, vuurt pas als
    // iemand DAAR aankomt — en daar kwam hij dus nooit. Wie vanaf /bewaarplicht met Google
    // binnenkwam, belandde alsnog in de wizard over facturen versturen.
    const redirectUrl = gevraagdeBestemming()
    // De bestemming reist mee als ?next= op de callback, en de rolkeuze als ?rol=.
    //
    // [OAUTH-ROL] Dat tweede is nieuw en het is de hele reparatie. Hier stond eerder een
    // `state`-object met de rol erin dat NERGENS aan signInWithOAuth werd meegegeven — het werd
    // berekend en weggegooid. Het comment eronder concludeerde dat `next` "de weg was die er al
    // lag", maar `next` draagt alleen de bestemming; de rol stond er nooit in. De callback
    // schreef intussen onvoorwaardelijk 'zzper', dus elke boekhouder die via Google binnenkwam
    // werd als ZZP'er aangemaakt.
    //
    // Een eigen parameter in plaats van iets in `next` verstoppen: `next` is een bestemming en
    // wordt als bestemming gecontroleerd, en er zit een geval in waarin er helemaal geen
    // bestemming is (een gewone registratie zonder ?redirect=). Twee dingen door één opening
    // persen zou precies dat geval stil laten vallen.
    const callback = new URL('/api/auth/callback', window.location.origin)
    if (redirectUrl) callback.searchParams.set('next', redirectUrl)
    callback.searchParams.set(ROLE_PARAM, role)
    // [KLUIS] Alleen zetten als het er is: parsePurpose leest alles wat niet exact 'archief' is
    // als 'boekhouden', dus een lege of afwezige parameter komt op hetzelfde neer. Niets zetten
    // houdt de URL leesbaar voor het geval dat verreweg het vaakst voorkomt.
    if (purpose === 'archief') callback.searchParams.set(PURPOSE_PARAM, purpose)

    const { error } = await getBrowserClient().auth.signInWithOAuth({
      provider: 'google',
      options: {
        // Basic sign-in only — we no longer request Gmail inbox access here.
        // Gmail connecting is a separate, opt-in step during onboarding.
        scopes: 'email profile',
        redirectTo: callback.toString(),
      },
    })

    clearTimeout(resetTimer)

    if (error) {
      setError('reg.googleFout')
      setGoogleLoading(false)
    }
  }

  async function handleRegister() {
    // [DUBBEL-VERSTUREN] Loopt er al een poging, dan houdt het hier op. De verzendknop is
    // tijdens het wachten uitgeschakeld, maar Enter ging daar dwars doorheen: de toets riep
    // handleRegister() rechtstreeks aan, zonder naar `loading` te kijken. Twee keer Enter
    // achter elkaar — niet ongewoon als er even niets lijkt te gebeuren — leverde dus twee
    // signUp-aanroepen op, waarvan de tweede terugkwam met "dit adres bestaat al". De
    // gebruiker las dan dat hij al een account had, terwijl zijn registratie een fractie
    // eerder was gelukt.
    if (loading || googleLoading) return

    // [FUNNEL-METING] Geteld ná de dubbel-verstuurwacht en vóór de veldvalidatie: dit is de
    // POGING. Het verschil met register_completed is precies de vraag "hoeveel mensen wilden wel
    // maar kwamen er niet doorheen", en die vraag verdwijnt als we pas bij succes zouden meten.
    trackFunnel(FUNNEL_EVENTS.registerStarted, { vak, ...campagne() })

    // Client-side check before we call Supabase, with simple field messages.
    // [TAAL] Sleutels, geen zinnen: een melding die als Nederlandse string in de state gaat is in
    // elke andere taal onbereikbaar op het moment dat hij wordt gezet.
    const errs: { name?: MessageKey; email?: MessageKey; password?: MessageKey } = {}
    if (!fullName.trim()) errs.name = 'reg.vulNaam'
    if (!email.trim()) errs.email = 'reg.vulEmail'
    else if (!EMAIL_REGEX.test(email.trim())) errs.email = 'reg.emailKloptNiet'
    if (password.length < 6) errs.password = 'reg.wachtwoordKort'

    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return
    }

    // [REGISTER-FOUT] Vanaf hier hetzelfde adres als het formulier controleerde. De controle
    // hierboven gebruikt .trim(), maar naar Supabase ging de ruwe waarde — dus " jan@x.nl "
    // kwam door onze eigen controle en werd door de server geweigerd. Met de oude
    // foutafhandeling las de gebruiker dan dat hij al een account had.
    const schoonEmail = email.trim()
    setEmail(schoonEmail)

    setFieldErrors({})
    setEmailTaken(false)
    setLoading(true)
    setError(null)

    // [COHERENCE-REGISTER] Pass the registration fields as signUp metadata so the
    // SECURITY DEFINER handle_new_user trigger writes them into the profile server-side.
    // Previously the browser did a profiles.upsert right after signUp, but with email
    // confirmation ON there is no session yet, so the anon client hit RLS and the flow
    // dead-ended before the "check your e-mail" screen. The trigger has no such problem.
    const { data, error: signUpError } = await getBrowserClient().auth.signUp({
      email: schoonEmail,
      password,
      options: {
        // [BEVESTIGINGSLINK] Waar de link in de bevestigingsmail uitkomt.
        //
        // Dit stond er niet, en zonder deze regel valt Supabase terug op de Site URL — de
        // homepage. De bezoeker klikte dus op "Bevestig je e-mailadres", zijn account werd
        // geactiveerd, en hij belandde op een marketingpagina waar hij nog steeds uitgelogd was.
        // De `?code=` die Supabase meestuurt werd daar door niemand ingewisseld; app/page.tsx
        // gaat er in zoveel woorden van uit dat die code daar nooit landt.
        //
        // De README bij onze eigen e-mailtemplates beweerde intussen dat de ConfirmationURL
        // "via emailRedirectTo → onze PKCE-callback" loopt. Dat was niet waar tot deze regel.
        //
        // Nu komt hij uit op /api/auth/callback, die de code inwisselt voor een sessie en de
        // gebruiker doorstuurt — mét de bestemming erbij, zodat wie zijn archief kwam wegzetten
        // in zijn kluis uitkomt en niet in de wizard. ⚠️ Vereist dat deze URL in Supabase onder
        // Redirect URLs staat; zie docs/AUTH_SETUP_GUIDE.md §B.1.
        emailRedirectTo: bevestigingsBestemming(),
        data: {
          full_name: fullName,
          role, // 'zzper' | 'accountant'
          company_name: companyName,
          kvk_number: kvk,
          btw_number: btw,
          // register already collected role + company, so skip the wizard's
          // welcome/role/company screens (step 4 = Gmail for ZZP, invite for accountant).
          onboarding_step: 4,
          // [KLUIS] account_purpose_archief.sql leest dit: bij 'archief' wordt
          // onboarding_done meteen true, want die wizard gaat over facturen versturen en
          // een mailboxkoppeling — geen van beide waar deze bezoeker voor kwam.
          account_purpose: purpose,
          // [VAK-BRUG] profile_vak.sql leest dit en zet het op profiles.vak. Alleen meesturen
          // als we het weten: een lege string zou als 'een vak' door de trigger reizen en daar
          // NULLIF'd worden — hetzelfde resultaat, maar via een omweg die niets zegt.
          ...(vak ? { vak } : {}),
        },
      },
    })

    if (signUpError) {
      // [REGISTER-FOUT] Zeg wat er werkelijk mis is. Hier stond `status === 422 || …'already'`
      // en dat vertaalde ALLES met code 422 naar "dit e-mailadres is al geregistreerd" — terwijl
      // Supabase diezelfde 422 ook stuurt voor een te zwak wachtwoord en voor registratie die
      // uitstaat. Zet iemand de minimale wachtwoordlengte in Supabase hoger dan de zes tekens
      // die dit formulier controleert, dan las een nieuwe gebruiker dus "je hebt al een account"
      // en werd naar inloggen gestuurd, waar hij niet binnenkomt. Een foutmelding die de
      // verkeerde kant op wijst kost meer dan geen foutmelding.
      const code = (signUpError as { code?: string }).code
      const melding = signUpError.message?.toLowerCase() ?? ''

      if (code === 'user_already_exists' || melding.includes('already')) {
        setEmailTaken(true)
      } else if (code === 'weak_password' || melding.includes('password')) {
        // De server stelt strengere eisen dan dit formulier kent. Zeg het bij het veld waar het
        // over gaat, niet als algemene fout onderaan.
        setFieldErrors({ password: 'reg.wachtwoordZwakServer' })
      } else if (code === 'over_email_send_rate_limit' || signUpError.status === 429) {
        setError('reg.teVeelPogingen')
      } else if (code === 'signup_disabled' || code === 'email_provider_disabled') {
        setError('reg.emailUit')
      } else if (code === 'email_address_invalid' || melding.includes('email')) {
        setFieldErrors({ email: 'reg.emailKloptNiet' })
      } else {
        setError('reg.mislukt')
      }
      setLoading(false)
      return
    }

    if (!data.user) {
      setError('reg.mislukt')
      setLoading(false)
      return
    }

    // Supabase returns a user with EMPTY identities[] when the email already exists
    // (security measure to avoid leaking which emails are registered).
    // Detect this and show the correct message instead of failing on profile insert.
    if (data.user.identities && data.user.identities.length === 0) {
      setEmailTaken(true)
      setLoading(false)
      return
    }

    // [COHERENCE-REGISTER] The profile is now written by the handle_new_user trigger
    // from the signUp metadata above (SECURITY DEFINER, so it works whether or not a
    // session exists). No client-side profiles write here — that was the RLS dead end.

    // [BOEK-015] fix: if email confirmation is enabled, signUp returns a user
    // but NO active session. Check and guide the user instead of a silent
    // redirect to /dashboard that would just bounce back to /login.
    const { data: sessionData } = await getBrowserClient().auth.getSession()
    if (!sessionData.session) {
      // [FUNNEL-METING] Het account BESTAAT nu; alleen de bevestiging staat nog open. Hier tellen
      // en niet na de mail, want de bevestigingsklik landt op een andere route in een ander
      // tabblad — daar meten zou een deel van de geslaagde registraties structureel missen.
      trackFunnel(FUNNEL_EVENTS.registerCompleted, { vak, ...campagne() })
      setEmailSent(true)
      setLoading(false)
      return
    }

    // [COHERENCE-REGISTER] Defensive self-heal for the confirmation-OFF path: a session
    // exists, so this authenticated upsert passes RLS and writes the exact registration
    // data. It is redundant when the handle_new_user metadata trigger is applied (same
    // values), but it guarantees the accountant role + company/kvk/btw are stored even if
    // that migration hasn't been applied yet — closing the silent-wrong-data window. The
    // no-session (confirmation-ON) path above can't do this (anon RLS) and relies on the
    // trigger. Best-effort: a failure here never blocks the redirect.
    //
    // [VANGNET-SPLITSING] En daarom staat account_purpose NIET in deze rij. Die kolom komt uit
    // account_purpose_archief.sql — in productie toegepast, maar een verse dev- of
    // stagingdatabase begint zonder. Ontbreekt die migratie, dan weigert PostgREST de HELE rij
    // (PGRST204) — dus dan werd ook de rol, de bedrijfsnaam, het KVK- en het BTW-nummer niet
    // geschreven. Precies in het geval waarvoor dit vangnet bestaat ("mocht die migratie nog
    // niet zijn toegepast") viel het dus als eerste om, stil, met alleen een console-regel.
    // Wie zich als boekhouder registreerde werd dan een ZZP'er.
    const { error: profileError } = await getBrowserClient()
      .from('profiles')
      .upsert({
        id: data.user.id,
        role,
        full_name: fullName,
        company_name: companyName,
        kvk_number: kvk,
        btw_number: btw,
        email: schoonEmail,
        onboarding_step: 4,
        // [KLUIS] Deze kolom bestaat altijd, dus die hoort hier thuis: een archiefaccount heeft
        // geen wizard te doorlopen, en dat moet ook waar zijn als de migratie hieronder ontbreekt.
        onboarding_done: purpose === 'archief',
      }, { onConflict: 'id' })
    if (profileError) {
      console.error('[COHERENCE-REGISTER] post-session profile upsert failed (non-fatal):', profileError)
    }

    // [KLUIS] Het doel apart, om de reden hierboven. Mislukt dit (kolom bestaat nog niet), dan
    // mist deze bezoeker een andere begroeting op zijn kluis — niet zijn registratie, en niet
    // zijn kluis: die twee hangen aan de rij hierboven, die wél doorging.
    if (purpose === 'archief') {
      const { error: purposeError } = await getBrowserClient()
        .from('profiles')
        .update({ account_purpose: 'archief' })
        .eq('id', data.user.id)
      if (purposeError) {
        console.error('[KLUIS] account_purpose niet gezet (migratie toegepast?):', purposeError)
      }
    }

    // [KLUIS] Een archiefaccount landt in zijn kluis, niet in een wizard over facturen.
    // [SEC-REDIRECT] En nooit ongecontroleerd op een bestemming uit de querystring: hier stond
    // `router.push(decodeURIComponent(redirectUrl))`, wat volgens de documentatie van deze router
    // uitdrukkelijk een XSS-gat is (een `javascript:`-URL wordt UITGEVOERD op onze eigen pagina) —
    // en dat precies op het moment dat er net een verse sessie is aangemaakt.
    // [FUNNEL-METING] Het tweede geslaagde pad: bevestiging staat uit, er is meteen een sessie.
    // Beide uitgangen tellen hetzelfde event, want voor de trechter zijn het dezelfde uitkomst —
    // er is een account. Alleen hier tellen zou elke registratie missen die op een
    // bevestigingsmail wacht, en dat is in productie juist de normale route.
    trackFunnel(FUNNEL_EVENTS.registerCompleted, { vak, ...campagne() })
    router.push(safeRedirect(searchParams.get('redirect'), landingPath(purpose)))
  }

  // [BOEK-015] email confirmation screen
  if (emailSent) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-md text-center">
          <div aria-hidden="true" style={{ fontSize: "48px", marginBottom: "16px" }}>📧</div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#202124", margin: "0 0 8px" }}>
            {t('reg.controleerMail')}
          </h1>
          <p style={{ fontSize: "15px", color: "#5f6368", margin: "0 0 24px" }}>
            {t('reg.linkGestuurd', { email })}
          </p>

          {/* [FUNNEL-OVERDRACHT] Dit scherm is de stilste plek in de hele trechter: de
              bevestigingsmail opent vaak een nieuw tabblad, dus de bezoeker laat dit scherm
              achter zonder te weten wat er met zijn werk gebeurde. Wie hier komt vanaf
              /factuur-maken heeft net een factuur ingevuld, en de vraag die dan door zijn hoofd
              gaat is niet "waar is de mail" maar "ben ik dat kwijt". Eén zin beantwoordt dat —
              en alleen als er ook echt iets klaarstaat, want een geruststelling over iets dat er
              niet is, is de volgende loze belofte. */}
          {factuurKlaar && (
            <div
              role="status"
              style={{
                background: "#E6F4EA", border: "1px solid #137333", color: "#137333",
                borderRadius: "12px", padding: "12px 14px", margin: "0 0 24px",
                fontSize: "14px", lineHeight: 1.5, textAlign: "start",
              }}
            >
              <strong>{t('reg.factuurBewaardKop')}</strong> {t('reg.factuurBewaard')}
            </div>
          )}

          {/* Mét de bestemming erbij. Hier stond een kale /login, en dat is precies de plek waar
              een uitnodiging verdween: wie via /invite/accept?token=… registreerde, kwam op dit
              scherm en verloor de link naar de uitnodiging waarvoor hij kwam. Hij moest hem
              opnieuw in zijn mailbox opzoeken. loginHref draagt de ?redirect= al mee. */}
          <a
            href={loginHref}
            style={{
              display: "inline-block", padding: "14px 24px", borderRadius: "12px",
              background: "#1A73E8", color: "#fff", textDecoration: "none",
              fontSize: "15px", fontWeight: 600,
            }}
          >
            {t('reg.naarInloggen')}
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-md">

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">BoekBrug</h1>
          <p className="text-gray-500 text-sm mt-1">{copy.subtitle}</p>
          <p className="text-gray-600 text-sm mt-3">{copy.promise}</p>
          <p className="text-gray-400 text-xs mt-1">{copy.reassurance}</p>
        </div>

        {/* [TAAL-POORT] Op de deur, niet erachter — zie AuthLanguageSwitch. */}
        <div className="mb-6">
          <AuthLanguageSwitch />
        </div>

        {/* Stap 1 — Rol kiezen */}
        {zichtbareStap === 1 && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-gray-700 text-center">{t('reg.wieBenJij')}</p>
            <button
              onClick={() => { setRole('zzper'); setStep(2) }}
              className="w-full border-2 border-gray-200 rounded-xl p-4 text-start hover:border-blue-500 active:scale-[0.98] transition-all"
            >
              <p className="font-medium text-gray-900">{t('reg.zzper')}</p>
              <p className="text-sm text-gray-500">{t('reg.zzperUitleg')}</p>
            </button>
            <button
              onClick={() => { setRole('accountant'); setStep(2) }}
              className="w-full border-2 border-gray-200 rounded-xl p-4 text-start hover:border-blue-500 active:scale-[0.98] transition-all"
            >
              <p className="font-medium text-gray-900">{t('reg.boekhouder')}</p>
              <p className="text-sm text-gray-500">{t('reg.boekhouderUitleg')}</p>
            </button>
          </div>
        )}

        {/* Stap 2 — Kies methode */}
        {zichtbareStap === 2 && (
          <div className="space-y-4">

            {/* [Google-OAuth] Google register button — shown prominently in step 2 */}
            <button
              type="button"
              onClick={handleGoogleRegister}
              disabled={googleLoading || loading}
              className="w-full flex items-center justify-center gap-3 border border-gray-200 rounded-xl py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {googleLoading ? (
                <span className="w-5 h-5 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
              ) : (
                <GoogleIcon />
              )}
              {googleLoading ? t('auth.verbinden') : t('reg.metGoogle')}
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-100" />
              <span className="text-xs text-gray-400">{t('reg.ofMetEmail')}</span>
              <div className="flex-1 h-px bg-gray-100" />
            </div>

            {/* Email + password fields — in een <form>, zodat Enter vanuit elk veld verstuurt en
                een mobiel toetsenbord een "Ga"-toets toont in plaats van een regeleinde. */}
            <form onSubmit={e => { e.preventDefault(); handleRegister() }} className="space-y-4">
              <div>
                <label htmlFor="reg-name" className="block text-sm font-medium text-gray-700 mb-1">{t('reg.naam')}</label>
                <input id="reg-name" type="text" value={fullName} onChange={e => { setFullName(e.target.value); wisFout('name') }}
                  autoComplete="name"
                  aria-describedby={fieldErrors.name ? 'reg-name-fout' : undefined}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={t('reg.naamVoorbeeld')}
                  style={{ fontSize: '16px' }} />
                {fieldErrors.name && <p id="reg-name-fout" role="alert" className="text-xs text-red-600 mt-1">{t(fieldErrors.name)}</p>}
              </div>
              <div>
                <label htmlFor="reg-company" className="block text-sm font-medium text-gray-700 mb-1">{t('reg.bedrijf')}</label>
                <input id="reg-company" type="text" value={companyName} onChange={e => setCompanyName(e.target.value)}
                  autoComplete="organization"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={t('reg.bedrijfVoorbeeld')}
                  style={{ fontSize: '16px' }} />
                <p className="text-xs text-gray-400 mt-1">{t('reg.laterInvullen')}</p>
              </div>
              <div>
                <label htmlFor="reg-kvk" className="block text-sm font-medium text-gray-700 mb-1">{t('reg.kvk')}</label>
                <input id="reg-kvk" type="text" value={kvk} onChange={e => setKvk(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="12345678"
                  style={{ fontSize: '16px' }} />
                <p className="text-xs text-gray-400 mt-1">{t('reg.laterInvullen')}</p>
              </div>
              <div>
                <label htmlFor="reg-btw" className="block text-sm font-medium text-gray-700 mb-1">{t('reg.btw')}</label>
                <input id="reg-btw" type="text" value={btw} onChange={e => setBtw(e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="NL123456789B01"
                  style={{ fontSize: '16px' }} />
                <p className="text-xs text-gray-400 mt-1">{t('reg.laterInvullen')}</p>
              </div>
              <div>
                <label htmlFor="reg-email" className="block text-sm font-medium text-gray-700 mb-1">{t('auth.email')}</label>
                <input id="reg-email" type="email" value={email} onChange={e => { setEmail(e.target.value); wisFout('email') }}
                  autoComplete="email"
                  aria-describedby={fieldErrors.email ? 'reg-email-fout' : undefined}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="jouw@email.nl"
                  style={{ fontSize: '16px' }} />
                {fieldErrors.email && <p id="reg-email-fout" role="alert" className="text-xs text-red-600 mt-1">{t(fieldErrors.email)}</p>}
              </div>
              <div>
                <label htmlFor="reg-password" className="block text-sm font-medium text-gray-700 mb-1">{t('auth.wachtwoord')}</label>
                <input
                  id="reg-password"
                  type="password"
                  value={password}
                  onChange={e => { setPassword(e.target.value); wisFout('password') }}
                  autoComplete="new-password"
                  enterKeyHint="go"
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="••••••••"
                  style={{ fontSize: '16px' }} />
                {fieldErrors.password && <p id="reg-password-fout" role="alert" className="text-xs text-red-600 mt-1">{t(fieldErrors.password)}</p>}
                {/* [WACHTWOORD-EIS] De eis stond alleen in de foutmelding, dus je las hem pas nadat
                    je hem had overtreden — en op een formulier dat je één keer in je leven invult
                    is dat precies het moment waarop iemand denkt dat hij iets fout doet. */}
                {!fieldErrors.password && <p className="text-xs text-gray-400 mt-1">{t('reg.wachtwoordEis')}</p>}
              </div>

              <ErrorMessage message={error ? t(error) : ''} />

              {/* Duplicate e-mail — clickable link to log in instead. */}
              {emailTaken && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                  <span className="text-red-400 text-sm mt-0.5 flex-shrink-0">✕</span>
                  <p className="text-sm text-red-600">
                    {t('reg.emailBezet')}{' '}
                    <a href={loginHref} className="font-semibold underline">{t('auth.inloggen')}</a>
                  </p>
                </div>
              )}

              <button type="submit" disabled={loading || googleLoading || !email || !password}
                className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50">
                {loading ? t('auth.bezig') : t(copy.ctaSleutel)}
              </button>
            </form>

            {/* [AVG] Consent — a reachable link to the terms/privacy at sign-up. */}
            <p className="text-xs text-gray-400 text-center leading-relaxed">
              {t('reg.akkoordVoor')}{' '}
              <a href="/voorwaarden" className="text-blue-600 underline">{t('reg.voorwaarden')}</a>{' '}
              {t('reg.akkoordTussen')}{' '}
              <a href="/privacy" className="text-blue-600 underline">{t('reg.privacy')}</a>.
            </p>

            {/* Permanent cross-link to login (keeps ?redirect=). */}
            <p className="text-sm text-gray-500 text-center">
              {t('reg.alAccount')}{' '}
              <a href={loginHref} className="text-blue-600 font-medium underline">{t('auth.inloggen')}</a>
            </p>

            {/* Terug naar de rolkeuze — en alleen als er een rolkeuze IS.
                Op het archiefpad is er geen stap 1: die bezoeker is per definitie een
                ondernemer met een eigen administratie, dus stap 1 wordt overgeslagen én niet
                gerenderd (zie de voorwaarde `!isArchief` hierboven). Deze knop zette hem
                daar toch naartoe, en dan viel de kaart leeg: geen stap 1, geen stap 2, alleen
                de kop. Geen foutmelding, geen weg terug — alleen de pagina opnieuw laden hielp,
                en dan was alles wat hij had ingevuld weg.

                Voor hem is /bewaarplicht het scherm waar hij vandaan komt, en dat is waar
                "terug" hoort uit te komen. */}
            {isArchief ? (
              <a href="/bewaarplicht"
                className="block w-full text-center text-gray-500 text-sm hover:text-gray-700">
                ← Terug
              </a>
            ) : (
              <button type="button" onClick={() => setStep(1)}
                className="w-full text-gray-500 text-sm hover:text-gray-700">
                ← Terug
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#fbbc04"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
    </svg>
  )
}

export default function RegisterPage() {
  // [TAAL] Ook het wachtscherm — dezelfde reden als op /login: het is het eerste wat een bezoeker
  // van /ar/blog hier ziet, en juist daarom viel het buiten elke sweep.
  const t = translator(useLocale())
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">{t('auth.laden')}</p>
      </div>
    }>
      <RegisterContent />
    </Suspense>
  )
}