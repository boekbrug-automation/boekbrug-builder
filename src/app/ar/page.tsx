// src/app/ar/page.tsx
// [LANDING-AR] The Arabic homepage — a translation of `/`, not a second product page.
//
// WHY IT EXISTS
// This app has published 53 Arabic articles and an /ar/blog for months, and an Arabic pricing
// page — and had no Arabic PRODUCT page. An Arabic reader could learn about bookkeeping from us,
// and could learn what it costs, and had nowhere to learn what the thing IS. The blog was doing
// acquisition into a door that did not exist: /ar was a 404.
//
// WHAT IT MUST NEVER BECOME
// A second opinion. Every sentence comes from belofte-ar.ts, which is a TRANSLATION of
// belofte.ts — see the rule at the top of that file. If this page ever promises something the
// Dutch homepage does not, this page is wrong, however well it reads.
//
// ONLY TOOLS THAT EXIST IN ARABIC ARE LINKED — and today that is none of them, so the tools
// section is simply absent rather than sending an Arabic reader to a Dutch calculator. That is
// the same small honesty /en applies to its own three missing tools. The moment a tool gets an
// Arabic version it belongs here.
//
// [TAAL] Direction is set on the main element, and every offset uses logical properties, so the
// page does not need a mirrored stylesheet to be right.

import type { Metadata } from 'next'
import Link from 'next/link'
import PublicHeader from '@/components/public-header'
import PublicFooter from '@/components/public-footer'
import {
  BELOFTE_KOP_AR,
  BELOFTE_KOP_2_AR,
  BELOFTE_UITLEG_AR,
  BELOFTE_GERUST_AR,
  BELOFTE_STAPPEN_AR,
  PROBLEEM_KOP_AR,
  PROBLEEM_1_AR,
  PROBLEEM_2_VET_AR,
  PROBLEEM_2_AR,
} from '@/lib/belofte-ar'

export const metadata: Metadata = {
  title: 'BoekBrug — الفواتير وضريبة القيمة المضافة والمحاسبة لأصحاب العمل الحر',
  description:
    'لستَ مضطراً لمسك الدفاتر — يكفي ألّا يضيع منك شيء. صوّر إيصالاتك أو دعها تصل عبر بريدك، وفي نهاية الربع يكون كل شيء جاهزاً لمحاسبك.',
  alternates: {
    canonical: '/ar',
    languages: { 'nl-NL': '/', 'en-GB': '/en', ar: '/ar', 'tr-TR': '/tr' },
  },
  openGraph: {
    title: 'BoekBrug — الجسر بينك وبين محاسبك',
    description: 'لستَ مضطراً لمسك الدفاتر. يكفي ألّا يضيع منك شيء.',
    type: 'website',
    locale: 'ar_AR',
  },
}

const wrap: React.CSSProperties = { maxWidth: 980, margin: '0 auto', padding: '0 20px' }
const arFont = 'var(--font-arabic), var(--font-sans), system-ui, sans-serif'
const btnPrimary: React.CSSProperties = { backgroundColor: '#1a73e8', color: '#fff', fontSize: 15, fontWeight: 600, padding: '13px 24px', borderRadius: 9999, textDecoration: 'none', display: 'inline-block' }
const btnGhost: React.CSSProperties = { backgroundColor: '#fff', color: '#1a73e8', fontSize: 15, fontWeight: 600, padding: '13px 24px', borderRadius: 9999, border: '1.5px solid #1a73e8', textDecoration: 'none', display: 'inline-block' }

export default function ArabicHome() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f8f9fa', fontFamily: arFont }}>
      <PublicHeader />

      <main dir="rtl">
        {/* Hero — the same two sentences as the Dutch page, in the same order. */}
        <section style={{ ...wrap, textAlign: 'center', paddingTop: 72, paddingBottom: 48 }}>
          <div style={{ display: 'inline-block', background: '#eaf3ff', color: '#1a73e8', fontSize: 13, fontWeight: 600, padding: '6px 14px', borderRadius: 9999, marginBottom: 20 }}>
            لأصحاب الأعمال الصغيرة ومحاسبيهم
          </div>
          <h1 style={{ fontSize: 42, fontWeight: 800, color: '#202124', lineHeight: 1.25, margin: '0 auto 18px', maxWidth: 720 }}>
            {BELOFTE_KOP_AR}
            <br />
            <span style={{ color: '#1a73e8' }}>{BELOFTE_KOP_2_AR}</span>
          </h1>
          <p style={{ fontSize: 18, color: '#5f6368', lineHeight: 1.8, margin: '0 auto 32px', maxWidth: 620 }}>
            {BELOFTE_UITLEG_AR}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/register" style={btnPrimary}>أنشئ حساباً مجانياً</Link>
            <Link href="/ar/prijzen" style={btnGhost}>الأسعار</Link>
          </div>
          <div style={{ fontSize: 13, color: '#9aa0a6', marginTop: 16 }}>{BELOFTE_GERUST_AR}</div>
        </section>

        {/* The problem, before the steps — same order as the Dutch page. */}
        <section style={{ ...wrap, paddingBottom: 44 }}>
          <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 18, padding: '28px 26px', maxWidth: 720, margin: '0 auto' }}>
            <h2 style={{ fontSize: 21, fontWeight: 700, color: '#202124', margin: '0 0 12px' }}>{PROBLEEM_KOP_AR}</h2>
            <p style={{ fontSize: 16, lineHeight: 1.9, color: '#3c4043', margin: '0 0 14px' }}>{PROBLEEM_1_AR}</p>
            <p style={{ fontSize: 16, lineHeight: 1.9, color: '#3c4043', margin: 0 }}>
              <strong>{PROBLEEM_2_VET_AR}</strong>{PROBLEEM_2_AR}
            </p>
          </div>
        </section>

        {/* The one task that remains, in three steps. */}
        <section style={{ ...wrap, paddingBottom: 48 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {BELOFTE_STAPPEN_AR.map((stap, i) => (
              <div key={stap.kop} style={{ padding: '4px 2px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 999, background: '#1a73e8', color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                    {i + 1}
                  </span>
                  <span style={{ fontSize: 16.5, fontWeight: 700, color: '#202124' }}>{stap.kop}</span>
                </div>
                <div style={{ fontSize: 14.5, lineHeight: 1.9, color: '#5f6368' }}>{stap.tekst}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Closing. The Dutch and English pages both end on the same invitation. */}
        <section style={{ ...wrap, paddingBottom: 72 }}>
          <div style={{ background: 'linear-gradient(135deg, #1a73e8, #0056d6)', borderRadius: 24, padding: '48px 32px', textAlign: 'center', color: '#fff' }}>
            <h2 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 10px' }}>وقت أقل على الإدارة؟</h2>
            <p style={{ fontSize: 17, opacity: 0.92, margin: '0 auto 24px', maxWidth: 520, lineHeight: 1.8 }}>
              ابدأ اليوم بالخطوة الأولى. حساب مجاني، في دقيقة واحدة.
            </p>
            <Link href="/register" style={{ backgroundColor: '#fff', color: '#1a73e8', fontSize: 16, fontWeight: 700, padding: '14px 30px', borderRadius: 9999, textDecoration: 'none', display: 'inline-block' }}>
              أنشئ حساباً مجانياً
            </Link>
          </div>
        </section>

        {/* The way back to the Dutch page, small and at the bottom — the same shape as /en. */}
        <section style={{ ...wrap, paddingBottom: 64, textAlign: 'center' }}>
          <p style={{ fontSize: 14.5, color: '#5f6368', margin: 0 }}>
            <Link href="/" style={{ color: '#1a73e8' }}>Lees deze pagina in het Nederlands →</Link>
          </p>
        </section>
      </main>

      <PublicFooter />
    </div>
  )
}
