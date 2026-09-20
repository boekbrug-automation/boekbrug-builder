'use client'

// src/app/login/page.tsx
// [Google-OAuth] Add Google OAuth login — May 2026

import { Suspense, useState, useEffect } from 'react'
import { getBrowserClient } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import { ErrorMessage } from '@/components/ui/Feedback'
import { isSafeRedirect, safeRedirect, withRedirect } from '@/lib/safe-redirect'
import { callbackFoutSleutel, herstelmailFout, inlogFout } from '@/lib/auth-errors'
// [TAAL-POORT] De deur sprak maar één taal. Zie AuthLanguageSwitch voor waarom dat juist HIER het
// duurst was: de knop die je uit het Nederlands haalt stond zelf achter het Nederlands.
import { AuthLanguageSwitch } from '@/components/i18n/AuthLanguageSwitch'
import { useLocale } from '@/lib/i18n/use-locale'
import { translator } from '@/lib/i18n/t'
import type { MessageKey } from '@/lib/i18n/messages'

function LoginContent() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  // [TAAL] Deze twee dragen een SLEUTEL, geen zin. Een foutmelding die als Nederlandse string in
  // de state gaat, is in elke andere taal onbereikbaar geworden op het moment dat hij werd gezet.
  const [error, setError] = useState<MessageKey | null>(null)
  const [needsConfirm, setNeedsConfirm] = useState(false)
  const [resendMsg, setResendMsg] = useState<MessageKey | null>(null)
  const [resending, setResending] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = translator(useLocale())

  // De bestemming die de bezoeker meebracht. [SEC-REDIRECT] Alleen een pad op onze eigen origin;
  // al het andere valt terug op /dashboard.
  const gewenst = searchParams.get('redirect')
  const bestemming = safeRedirect(gewenst, '/dashboard')

  // [AUTH-FOUT] De reden waarmee de OAuth-callback iemand hier terugzette.
  //
  // Die callback stuurt bij een mislukking naar /login?error=no_code of ?error=auth_failed — en
  // dit scherm las dat nooit. Wie met Google strandde kwam dus terug op een leeg inlogformulier
  // zonder één woord over wat er zojuist misging, en probeerde precies hetzelfde nog eens.
  //
  // De parameter wordt VERTAALD, niet getoond: een querystring is invoer van buiten, en die hoort
  // niet als melding terug op ons eigen inlogscherm te verschijnen.
  const callbackFout = callbackFoutSleutel(searchParams.get('error'))

  // Wie al een sessie heeft, hoort hier niet naar een inlogformulier te kijken — en al helemaal
  // niet naar de vraag om opnieuw zijn wachtwoord in te tikken. Mét zijn bestemming, zodat een
  // uitnodiging ook hier blijft werken. (In een effect, niet in de render: dan bouwt `next build`
  // geen Supabase-client — zie de RULE in src/lib/supabase.ts.)
  useEffect(() => {
    let afgebroken = false
    getBrowserClient().auth.getSession().then(({ data }) => {
      if (!afgebroken && data.session) router.replace(bestemming)
    })
    return () => { afgebroken = true }
  }, [router, bestemming])

  // [Google-OAuth] Reset loading state when user returns via browser back button
  // pageshow + focus + visibilitychange covers all browsers
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

  // [Google-OAuth] Google login via Supabase OAuth
  async function handleGoogleLogin() {
    setGoogleLoading(true)
    setError(null)

    // [Google-OAuth] Auto-reset after 10s in case user cancels or goes back
    const resetTimer = setTimeout(() => setGoogleLoading(false), 10_000)

    // [BESTEMMING] Mét ?next=, want anders valt de bestemming hier stil weg. Een uitgenodigde
    // boekhouder komt binnen via /login?redirect=/invite/accept?token=… (zie invite/accept), en
    // koos hij dan "Inloggen met Google", dan kwam hij uit op zijn dashboard met de uitnodiging
    // nergens meer in beeld — hij moest de mail opnieuw opzoeken. De callback leest `next` al.
    const callback = new URL('/api/auth/callback', window.location.origin)
    if (isSafeRedirect(gewenst)) callback.searchParams.set('next', gewenst)

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
      setGoogleLoading(false)
      setError('auth.googleFout')
    }
  }

  async function handleLogin() {
    // [DUBBEL-VERSTUREN] Loopt er al een poging, dan houdt het hier op. De knop is tijdens het
    // wachten uitgeschakeld, maar Enter ging daar dwars doorheen — en twee inlogpogingen tellen
    // allebei mee voor de ratelimiet van Supabase.
    if (loading || googleLoading) return

    setLoading(true)
    setError(null)
    setNeedsConfirm(false)
    setResendMsg(null)

    // Hetzelfde adres als op het scherm staat. Zonder trim werd " jan@x.nl " door de server
    // geweigerd en las de gebruiker dat zijn wachtwoord onjuist was.
    const { error } = await getBrowserClient().auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    if (error) {
      // [AUTH-FOUT] Zeg wat er werkelijk misging. Hier stond één `if` voor "nog niet bevestigd"
      // en een `else` die al het andere "E-mail of wachtwoord is onjuist" noemde — óók een 429.
      // Wie dát leest tikt zijn wachtwoord opnieuw, dus opnieuw een poging, dus een langere
      // blokkade: de melding maakte het probleem groter dat ze beschreef. Zie src/lib/auth-errors.ts.
      const fout = inlogFout({
        code: (error as { code?: string }).code,
        status: error.status,
        message: error.message,
      })
      if (fout.bevestigNodig) setNeedsConfirm(true)
      else setError(fout.sleutel)
      setLoading(false)
      return
    }

    // [SEC-REDIRECT] Nooit ongecontroleerd naar een bestemming uit de querystring. Hier stond
    // `router.push(decodeURIComponent(redirectUrl))`, en dat is volgens de documentatie van deze
    // router uitdrukkelijk een XSS-gat: een `javascript:`-URL wordt dan UITGEVOERD op onze eigen
    // pagina, met de sessie die net is aangemaakt. De tweede decodeURIComponent is ook weg:
    // searchParams.get() heeft de waarde al gedecodeerd, en die dubbele slag liep stuk op een
    // letterlijk procentteken (URIError → het scherm bleef op "Bezig..." staan).
    router.push(bestemming)
  }

  // Re-send the confirmation e-mail for an unconfirmed account.
  async function handleResend() {
    // Zonder slot en zonder zichtbare voortgang tikt iemand deze knop drie keer aan omdat er
    // niets lijkt te gebeuren — en loopt daarmee tegen de verzendlimiet van Supabase aan, die
    // hem juist de mail onthoudt waar hij op wacht.
    if (resending) return
    setResending(true)
    setResendMsg(null)
    const { error } = await getBrowserClient().auth.resend({ type: 'signup', email: email.trim() })
    setResendMsg(
      error
        ? herstelmailFout({ status: error.status, message: error.message }).sleutel
        : 'auth.mailOpnieuwGestuurd'
    )
    setResending(false)
  }

  function goToRegister() {
    // [SEC-REDIRECT] Alleen doorgeven wat de ontvanger ook zou accepteren — een waarde
    // meegeven die daar wordt weggegooid is een belofte die je niet waarmaakt.
    router.push(isSafeRedirect(gewenst)
      ? `/register?redirect=${encodeURIComponent(gewenst)}`
      : '/register'
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-md">

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">BoekBrug</h1>
          <p className="text-gray-500 text-sm mt-1">{t('auth.slogan')}</p>
        </div>

        {/* [TAAL-POORT] Op de deur, niet erachter. */}
        <div className="mb-6">
          <AuthLanguageSwitch />
        </div>

        {/* [Google-OAuth] Google login button */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={googleLoading || loading}
          className="w-full flex items-center justify-center gap-3 border border-gray-200 rounded-xl py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 active:scale-[0.98] transition-all disabled:opacity-50 mb-6"
        >
          {googleLoading ? (
            <span className="w-5 h-5 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
          ) : (
            <GoogleIcon />
          )}
          {googleLoading ? t('auth.verbinden') : t('auth.metGoogle')}
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-gray-100" />
          <span className="text-xs text-gray-400">{t('auth.of')}</span>
          <div className="flex-1 h-px bg-gray-100" />
        </div>

        {/* De melding van de callback staat bovenaan, want ze gaat over wat er zojuist misging —
            niet over wat je nu intikt. */}
        {callbackFout && (
          <div role="alert" className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-4">
            <span aria-hidden className="text-amber-500 text-sm mt-0.5 flex-shrink-0">!</span>
            <p className="text-sm text-amber-700">{t(callbackFout)}</p>
          </div>
        )}

        {/* In een <form>: Enter verstuurt vanuit elk veld en een mobiel toetsenbord toont een
            "Ga"-toets in plaats van een regeleinde. Stond als bekend punt in UX_REVIEW_2026. */}
        <form onSubmit={e => { e.preventDefault(); handleLogin() }} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 mb-1">{t('auth.email')}</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="jouw@email.nl"
                style={{ fontSize: '16px' }} // prevent iOS zoom
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">{t('auth.wachtwoord')}</label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                enterKeyHint="go"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
                style={{ fontSize: '16px' }} // prevent iOS zoom
              />
              <div className="text-end mt-1">
                {/* [BESTEMMING] Mét de bestemming: dit was een kale href, en daarmee verloor wie
                    onderweg zijn wachtwoord herstelde de uitnodiging of de deeplink waarvoor hij
                    kwam — de keten eindigde op een kaal /login en dus op /dashboard. */}
                <a href={withRedirect('/wachtwoord-vergeten', gewenst)} className="text-sm text-blue-600 hover:underline">
                  {t('auth.wachtwoordVergeten')}
                </a>
              </div>
            </div>

            <ErrorMessage message={error ? t(error) : ''} />

            {/* Unconfirmed e-mail — offer to re-send the confirmation link. */}
            {needsConfirm && (
              <div className="flex flex-col gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                <p className="text-sm text-amber-700">{t('auth.bevestigEerst')}</p>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending}
                  className="self-start text-sm font-medium text-blue-600 hover:underline disabled:opacity-50"
                >
                  {resending ? t('auth.mailVersturen') : t('auth.mailOpnieuw')}
                </button>
                {resendMsg && <p className="text-sm text-amber-700">{t(resendMsg)}</p>}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {loading ? t('auth.bezig') : t('auth.inloggen')}
            </button>
          </form>

          <button
            type="button"
            onClick={goToRegister}
            disabled={loading || googleLoading}
            className="w-full border border-gray-200 text-gray-700 rounded-xl py-2.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 mt-4"
          >
            {t('auth.nieuwAccount')}
          </button>

      </div>
    </div>
  )
}

// Inline Google SVG icon — no external dependency
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

export default function LoginPage() {
  // [TAAL] Ook het wachtscherm. Het is één woord en het duurt een tel, en juist daarom viel het
  // buiten elke sweep — terwijl het het eerste is wat een bezoeker van /ar/blog hier ziet.
  const t = translator(useLocale())
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">{t('auth.laden')}</p>
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}