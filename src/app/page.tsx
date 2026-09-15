// src/app/page.tsx
// [LANDING] Public homepage. Logged-in users go straight to the dashboard;
// everyone else gets the marketing landing — the destination we point ads and
// word-of-mouth at, with the free tools as the top-of-funnel hook.
//
// OAuth `?code=` never lands here: signInWithOAuth redirectTo is
// /api/auth/callback (see login/register), so the homepage is free to render.

import type { Metadata } from 'next'
import Link from 'next/link'
import {
  BELOFTE_KOP,
  BELOFTE_KOP_2,
  BELOFTE_UITLEG,
  BELOFTE_GERUST,
  BELOFTE_STAPPEN,
  PROBLEEM_KOP,
  PROBLEEM_1,
  PROBLEEM_2_VET,
  PROBLEEM_2,
} from '@/lib/belofte'
import { redirect, unstable_rethrow } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { TOOLS } from '@/lib/tools'
import PublicFooter from '@/components/public-footer'
import PublicHeader from '@/components/public-header'
import { SITE_URL, absoluteUrl } from '@/lib/site'

export const metadata: Metadata = {
  title: 'BoekBrug — facturen, BTW en boekhouding voor ZZP’ers',
  description:
    'BoekBrug is de brug tussen jou en je boekhouder. Maak en scan facturen, houd je BTW bij en werk samen met je boekhouder. Plus gratis tools, zonder account.',
  alternates: { canonical: '/', languages: { 'nl-NL': '/', 'en-GB': '/en' } },
  openGraph: {
    title: 'BoekBrug — de brug tussen jou en je boekhouder',
    description: 'Maak en scan facturen, houd je BTW bij en werk samen met je boekhouder. Gratis tools, zonder account.',
    type: 'website',
  },
}

const wrap: React.CSSProperties = { maxWidth: 980, margin: '0 auto', padding: '0 20px' }
const btnPrimary: React.CSSProperties = { backgroundColor: '#1a73e8', color: '#fff', fontSize: 15, fontWeight: 600, padding: '13px 24px', borderRadius: 9999, textDecoration: 'none', display: 'inline-block' }
const btnGhost: React.CSSProperties = { backgroundColor: '#fff', color: '#1a73e8', fontSize: 15, fontWeight: 600, padding: '13px 24px', borderRadius: 9999, border: '1.5px solid #1a73e8', textDecoration: 'none', display: 'inline-block' }

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'BoekBrug',
      url: SITE_URL,
      logo: absoluteUrl('/opengraph-image'),
    },
    {
      '@type': 'WebSite',
      name: 'BoekBrug',
      url: SITE_URL,
    },
  ],
}

// [BELOFTE-WAAR] Vijf kaarten, en twee ervan zeiden iets anders dan de app doet.
//
// "Scan en klaar — de AI leest de leverancier, het bedrag en de BTW voor je uit" verkocht dit
// product als een OCR-scanner. Dat is de drukste hoek van de markt en het is niet waar: lezen is
// de eerste van acht stappen, en de zeven daarna zijn het verschil. Er staat nu wat er gebeurt,
// in de volgorde waarin het gebeurt, met de laatste stap als de belangrijkste — wij vragen alleen
// wat niet zeker is. Elke stap in die zin bestaat in de code; er staat geen enkele die nog moet
// komen.
//
// En er ontbrak een hele kaart. Elf vakken hebben hun eigen werklaag met hun eigen woord
// (werkorder, rit, klus, opdracht, reparatie, les) — de kapper bewust niet, want een knipbeurt is
// bij de Kassa al afgerekend. Een monteur die deze pagina las, zag daar niets van terug en moest
// concluderen dat dit een boekhoudpakket is dat zijn werk niet kent.
const features = [
  { emoji: '🧾', title: 'Facturen die kloppen', body: 'Maak snel een factuur die klopt met de Nederlandse regels. Download hem als PDF.' },
  {
    emoji: '📄',
    title: 'Verwerkt, niet alleen gelezen',
    body: 'Wij lezen je bon, herkennen de leverancier, controleren de btw, zoeken dubbele facturen en koppelen de betaling. Je hoort alleen van ons wat niet zeker is.',
  },
  {
    emoji: '🔧',
    title: 'Ook je werk zelf',
    body: 'Werkorders, ritten, klussen of schoonmaakrondes — met de woorden van jouw vak. Je uren, onderdelen en kosten worden de factuur.',
  },
  { emoji: '📊', title: 'BTW altijd bij', body: 'Je omzet en BTW worden per kwartaal opgeteld. Zo is je aangifte zo klaar.' },
  { emoji: '🤝', title: 'Eén lijn met je boekhouder', body: 'Deel je facturen met je boekhouder. Geen mappen vol PDF’s meer mailen.' },
]

export default async function Home() {
  // [ENV-DEGRADE] The landing page must render for a visitor even when the deployment cannot talk
  // to Supabase at all. The middleware already degrades to "no session" when the keys are missing,
  // but this page then threw one layer deeper: createServerSupabaseClient reads the same two keys
  // with `!`, and the client library refuses to be constructed without them — so a single typo in
  // an environment variable turned the front door into a 500 while /voorwaarden and /privacy (which
  // do not build a client) kept working.
  //
  // The question this check asks is answerable without a backend: if we cannot verify any session,
  // nobody is logged in, so the public landing is the correct page. That is a degradation of a
  // ROUTING decision, never of data — no figure on this page comes from the database, and
  // createServerSupabaseClient itself is deliberately left strict, because a screen that reads
  // money must fail loudly rather than render an empty ledger.
  //
  // redirect() throws NEXT_REDIRECT internally, so it stays OUTSIDE the try: catching it here would
  // silently keep a logged-in owner on the marketing page.
  let user = null
  try {
    const supabase = await createServerSupabaseClient()
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch (e) {
    // [DYNAMIC-SIGNAL] Next signals control flow by THROWING — and the build proved it: the first
    // version of this catch swallowed the DynamicServerError that `cookies()` raises during the
    // static prerender pass, which would have let this route be cached as a static page. A
    // logged-in owner would then get the marketing landing out of the cache instead of the
    // redirect to /dashboard. unstable_rethrow is the documented way to let those internal errors
    // pass (node_modules/next/dist/docs/…/unstable_rethrow.md) and catch only ours.
    unstable_rethrow(e)
    console.error('[ENV-DEGRADE] homepage session check unavailable — rendering the public landing', e)
  }
  if (user) redirect('/dashboard')

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicHeader />

      {/* Hero */}
      <section style={{ ...wrap, textAlign: 'center', paddingTop: 72, paddingBottom: 48 }}>
        <div style={{ display: 'inline-block', background: '#eaf3ff', color: '#1a73e8', fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 9999, marginBottom: 20 }}>
          Voor kleine ondernemers en hun boekhouder
        </div>
        {/* [BELOFTE] Geen opsomming van functies meer — die plaatst BoekBrug in een
            featurevergelijking met SnelStart en Moneybird die het verliest én niet hoeft te
            voeren. De kop zegt nu wat de gebruiker NIET MEER HOEFT. Bron: src/lib/belofte.ts. */}
        <h1 style={{ fontSize: 46, fontWeight: 800, color: '#202124', letterSpacing: -1, lineHeight: 1.1, margin: '0 auto 18px', maxWidth: 720 }}>
          {BELOFTE_KOP}
          <br />
          <span style={{ color: '#1a73e8' }}>{BELOFTE_KOP_2}</span>
        </h1>
        <p style={{ fontSize: 19, color: '#5f6368', lineHeight: 1.6, margin: '0 auto 32px', maxWidth: 600 }}>
          {BELOFTE_UITLEG}
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/register" style={btnPrimary}>Gratis account maken</Link>
          <Link href="/factuur-maken" style={btnGhost}>Direct een factuur maken</Link>
        </div>
        <div style={{ fontSize: 13, color: '#bdc1c6', marginTop: 16 }}>{BELOFTE_GERUST}</div>
      </section>

      {/* [PROBLEEM] Het probleem, vóór de stappen. De kop zegt wat je NIET meer hoeft; zonder
          het probleem ernaast hangt die belofte in de lucht. Bron: src/lib/belofte.ts, gedeeld
          met de Engelse pagina zodat die nooit meer zegt dan deze. */}
      <section style={{ ...wrap, paddingBottom: 44 }}>
        <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 18, padding: '28px 26px', maxWidth: 720, margin: '0 auto' }}>
          <h2 style={{ fontSize: 21, fontWeight: 700, color: '#202124', margin: '0 0 12px' }}>{PROBLEEM_KOP}</h2>
          <p style={{ fontSize: 16, lineHeight: 1.65, color: '#3c4043', margin: '0 0 14px' }}>{PROBLEEM_1}</p>
          <p style={{ fontSize: 16, lineHeight: 1.65, color: '#3c4043', margin: 0 }}>
            <strong>{PROBLEEM_2_VET}</strong>{PROBLEEM_2}
          </p>
        </div>
      </section>

      {/* [BELOFTE] De enige taak die de gebruiker overhoudt, in drie stappen. Staat BOVEN de
          functiekaarten: eerst wat hij moet doen, dan pas wat de app allemaal kan. */}
      <section style={{ ...wrap, paddingBottom: 40 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {BELOFTE_STAPPEN.map((stap, i) => (
            <div key={stap.kop} style={{ padding: '4px 2px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 999, background: '#1a73e8', color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: 16.5, fontWeight: 700, color: '#202124' }}>{stap.kop}</span>
              </div>
              <div style={{ fontSize: 14.5, lineHeight: 1.6, color: '#5f6368' }}>{stap.tekst}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section style={{ ...wrap, paddingBottom: 56 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          {features.map((f) => (
            <div key={f.title} style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 18, padding: 24 }}>
              <div style={{ fontSize: 30, marginBottom: 12 }} aria-hidden>{f.emoji}</div>
              <div style={{ fontSize: 17, fontWeight: 700, color: '#202124', marginBottom: 6 }}>{f.title}</div>
              <div style={{ fontSize: 14, lineHeight: 1.6, color: '#5f6368' }}>{f.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Free tools */}
      <section style={{ ...wrap, paddingBottom: 56 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 28, fontWeight: 800, color: '#202124', letterSpacing: -0.5, margin: '0 0 8px' }}>Begin gratis — zonder account</h2>
          <p style={{ fontSize: 16, color: '#5f6368', margin: 0 }}>Handige tools voor elke ZZP’er. Direct te gebruiken.</p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          {TOOLS.map((t) => (
            <Link key={t.slug} href={t.slug} style={{ display: 'block', background: '#fff', border: '1px solid #e0e0e0', borderRadius: 16, padding: 20, textDecoration: 'none' }}>
              <div style={{ fontSize: 26, marginBottom: 8 }} aria-hidden>{t.emoji}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#202124', marginBottom: 4 }}>{t.title}</div>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: '#5f6368' }}>{t.tagline}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* CTA band */}
      <section style={{ ...wrap, paddingBottom: 72 }}>
        <div style={{ background: 'linear-gradient(135deg, #1a73e8, #0056d6)', borderRadius: 24, padding: '48px 32px', textAlign: 'center', color: '#fff' }}>
          <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5, margin: '0 0 10px' }}>Minder tijd kwijt aan je administratie?</h2>
          <p style={{ fontSize: 17, opacity: 0.92, margin: '0 auto 24px', maxWidth: 480 }}>
            Zet vandaag de eerste stap. Gratis account, in een minuut geregeld.
          </p>
          <Link href="/register" style={{ backgroundColor: '#fff', color: '#1a73e8', fontSize: 16, fontWeight: 700, padding: '14px 30px', borderRadius: 9999, textDecoration: 'none', display: 'inline-block' }}>
            Gratis account maken
          </Link>
        </div>
      </section>

      {/* [LANDING-EN] De weg naar de Engelse versie. Onderaan en klein met opzet: de bezoeker
          die hier hoort is Nederlandstalig, en een taalkiezer bovenaan zou hem een keuze
          opdringen die hij niet heeft. Wie hem nodig heeft, zoekt hem — en vindt hem. */}
      <section style={{ ...wrap, paddingBottom: 64, textAlign: 'center' }}>
        <p style={{ fontSize: 14.5, color: '#5f6368', margin: 0 }}>
          <Link href="/en" style={{ color: '#1a73e8' }}>Read this page in English →</Link>
        </p>
      </section>

      <PublicFooter />
    </div>
  )
}
