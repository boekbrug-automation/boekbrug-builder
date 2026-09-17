'use client'

// src/app/prijzen/SubscribeButton.tsx
// [BILLING] The one button that takes money.
//
// Client component so the price page itself can stay a static, indexable server
// component. It posts to /api/billing/checkout and follows the Stripe URL that
// comes back.
//
// Three states matter and all three are handled, because a payment button that
// fails silently is worse than no button:
//   · logged out (401) → send to /register, not an error nobody can act on;
//   · billing not configured yet (503) → say so plainly;
//   · anything else → show the message and re-enable the button so the user can
//     retry. It never stays stuck on "Bezig…".
//
// ── [JAARPRIJS] THE BUTTON NAMES THE PERIOD IT CHARGES ──
// This posted an empty body, so the route fell back to "month" — which was the right default
// while a month was the only thing for sale. Since the annual price shipped it meant /prijzen
// advertised €179,91 per jaar that nobody could actually buy: the backend accepted the choice
// and no screen could make it. A price you publish and cannot sell is the mirror image of a
// price you charge and did not publish, and the second one is only worse because it is louder.
//
// So the interval is a required prop, not a default with an override. There is no
// SubscribeButton that does not say what it charges, and a reader of /prijzen can see next to
// each button which of the two amounts it will take.
//
// WHAT DOES NOT CROSS TO THE BROWSER: the Stripe price ids. The client sends "month" or "year",
// the server maps that to an id from its own environment, and the id itself never leaves the
// server — which is why `annualAvailable` below is a plain boolean and not a price.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { failureText } from '@/lib/server-message'
import type { PlusInterval } from '@/lib/plus-interval'

export default function SubscribeButton({
  interval,
  label,
  variant = 'primary',
}: {
  /** Which of the two published amounts this button charges. Required — see the header. */
  interval: PlusInterval
  label: string
  variant?: 'primary' | 'secondary'
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval }),
      })

      // Not logged in — you cannot subscribe to an account you do not have.
      // Bounce to registration and come straight back here afterwards.
      if (res.status === 401) {
        // De parameter heet `redirect`, niet `next`. Hij heette hier `next` en /register leest
        // die naam niet, dus "kom straks meteen hier terug" gebeurde nooit: de bezoeker maakte
        // een account en stond daarna in de onboarding, met de knop waar hij op klikte drie
        // stappen achter zich. (`next` bestaat wel, maar dat is de naam op de OAuth-callback.)
        router.push(`/register?redirect=${encodeURIComponent('/prijzen')}`)
        return
      }

      const body = await res.json().catch(() => ({}))

      if (!res.ok || !body?.url) {
        setError(failureText(res.status, body, 'Er ging iets mis. Probeer het opnieuw.'))
        setBusy(false)
        return
      }

      // Full navigation, not router.push — Stripe Checkout is a different origin.
      window.location.href = body.url
    } catch {
      setError('Geen verbinding. Controleer je internet en probeer opnieuw.')
      setBusy(false)
    }
  }

  const primary = variant === 'primary'

  return (
    <div>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        style={{
          width: '100%',
          padding: '14px 20px',
          fontSize: 16,
          fontWeight: 600,
          color: primary ? '#fff' : '#1A73E8',
          background: primary ? (busy ? '#8ab4f8' : '#1A73E8') : '#fff',
          border: primary ? 'none' : '1.5px solid #1A73E8',
          borderRadius: 10,
          cursor: busy ? 'default' : 'pointer',
          fontFamily: 'inherit',
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy ? 'Bezig…' : label}
      </button>

      {error && (
        <p role="alert" style={{ color: '#B3261E', fontSize: 14, margin: '10px 0 0', lineHeight: 1.5 }}>
          {error}
        </p>
      )}
    </div>
  )
}
