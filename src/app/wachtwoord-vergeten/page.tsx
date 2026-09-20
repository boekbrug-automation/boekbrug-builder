'use client'

// src/app/wachtwoord-vergeten/page.tsx
// Password reset — step 1: ask for e-mail, send a reset link.

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getBrowserClient } from '@/lib/supabase'
import { ErrorMessage } from '@/components/ui/Feedback'
import { herstelmailFout } from '@/lib/auth-errors'
import { EMAIL_REGEX } from '@/lib/validation'
// [BESTEMMING] The destination the visitor brought to /login travels through the whole reset chain.
import { withRedirect } from '@/lib/safe-redirect'
import { translator } from '@/lib/i18n/t'
import { useLocale } from '@/lib/i18n/use-locale'
import type { MessageKey } from '@/lib/i18n/messages'

function WachtwoordVergetenContent() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  // [TAAL] A KEY, not a sentence: a Dutch string in the state is unreachable in any other language.
  const [error, setError] = useState<MessageKey | null>(null)
  const [sent, setSent] = useState(false)
  const searchParams = useSearchParams()
  const t = translator(useLocale())

  // [BESTEMMING] Where the visitor was going before the password got in the way. Checked by
  // withRedirect on every use, so an unsafe value never reaches a link or the mail.
  const gewenst = searchParams.get('redirect')
  const loginHref = withRedirect('/login', gewenst)

  async function handleReset() {
    // [DUBBEL-VERSTUREN] Enter ging langs de uitgeschakelde knop heen, en elke poging telt mee
    // voor de verzendlimiet van Supabase — die je juist de mail onthoudt waar je op wacht.
    if (loading) return

    const schoonEmail = email.trim()
    if (!schoonEmail) {
      setError('reg.vulEmail')
      return
    }
    // De oude controle was `includes('@') && includes('.')` en liet "jan.de@vries" door: een
    // adres zonder domeinnaam. Dan is de mail onderweg naar niets en wacht iemand op post die
    // nooit komt — bij een herstelmail heb je geen enkele andere aanwijzing dat het misging.
    if (!EMAIL_REGEX.test(schoonEmail)) {
      setError('reg.emailKloptNiet')
      return
    }

    setLoading(true)
    setError(null)

    const { error: resetError } = await getBrowserClient().auth.resetPasswordForEmail(schoonEmail, {
      // [BESTEMMING] The reset screen gets the destination too, so the link in the mail lands the
      // visitor on a screen that still knows where they were going. GoTrue accepts any redirect on
      // the Site URL's own host, query string included — the same way /api/auth/callback?next=…
      // already travels on the confirmation mail (see docs/AUTH_SETUP_GUIDE.md §B.1).
      redirectTo: new URL(withRedirect('/wachtwoord-herstellen', gewenst), window.location.origin).toString(),
    })

    if (resetError) {
      // [AUTH-FOUT] Een ratelimiet is geen verzendstoring: "probeer opnieuw" is dan precies het
      // verkeerde advies, want elke nieuwe poging verlengt de wachttijd.
      setError(herstelmailFout({ status: resetError.status, message: resetError.message }).sleutel)
      setLoading(false)
      return
    }

    setSent(true)
    setLoading(false)
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-md text-center">
          <div aria-hidden="true" style={{ fontSize: '48px', marginBottom: '16px' }}>📧</div>
          <h1 className="text-2xl font-bold text-gray-900">{t('reg.controleerMail')}</h1>
          <p className="text-gray-500 text-sm mt-2">
            {t('auth.vergeten.linkGestuurd')}
          </p>
          <a
            href={loginHref}
            className="inline-block mt-6 text-sm text-blue-600 font-medium hover:underline"
          >
            {t('auth.terugNaarInloggen')}
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white p-8 rounded-2xl shadow-sm w-full max-w-md">

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">{t('auth.wachtwoordVergeten')}</h1>
          <p className="text-gray-500 text-sm mt-2">
            {t('auth.vergeten.uitleg')}
          </p>
        </div>

        <form onSubmit={e => { e.preventDefault(); handleReset() }} className="space-y-4">
            <div>
              <label htmlFor="reset-email" className="block text-sm font-medium text-gray-700 mb-1">{t('auth.email')}</label>
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                enterKeyHint="go"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="jouw@email.nl"
                style={{ fontSize: '16px' }} // prevent iOS zoom
              />
            </div>

            <ErrorMessage message={error ? t(error) : ''} />

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {loading ? t('auth.bezig') : t('auth.vergeten.stuurLink')}
            </button>

            <a
              href={loginHref}
              className="block text-center text-sm text-gray-500 hover:text-gray-700"
            >
              {t('auth.terugNaarInloggen')}
            </a>
        </form>

      </div>
    </div>
  )
}

export default function WachtwoordVergetenPage() {
  // [BESTEMMING] useSearchParams needs a Suspense boundary on a page Next prerenders statically —
  // the same shape as /login. [TAAL] The one word in the fallback comes from the catalogue.
  const t = translator(useLocale())
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">{t('auth.laden')}</p>
      </div>
    }>
      <WachtwoordVergetenContent />
    </Suspense>
  )
}
