// src/app/en/prijzen/page.tsx
// [BILLING/EN] English pricing page. A translated copy of /prijzen that REUSES
// the same price values from lib (single source of truth) and the same
// SubscribeButton — no billing logic is duplicated or changed here.

import type { Metadata } from 'next'
import Link from 'next/link'
import PublicHeader from '@/components/public-header'
import PublicFooter from '@/components/public-footer'
import { PLUS } from '@/lib/plan'
import { FAIR_USE_LIMITS, fairUseLimit } from '@/lib/fair-use'
import { BEWAARPLICHT_YEARS, KLUIS_GRACE_MONTHS, eur, KLUIS_PREPAY_YEAR_PRICE_EUR } from '@/lib/bewaarkluis'
import SubscribeButton from '@/app/prijzen/SubscribeButton'

export const metadata: Metadata = {
  title: 'Pricing — try it free, run your business on Plus | BoekBrug',
  description:
    `Try BoekBrug free: ${fairUseLimit('invoicesSent').free} invoices and ` +
    `${fairUseLimit('aiDocuments').free} AI-read documents per month. ` +
    `Plus costs ${PLUS.priceLabel} per month or ${PLUS.annualPriceLabel} per year (incl. VAT). ` +
    `No trial period, no automatic charge, and never a lock on your own administration.`,
  keywords: ['boekbrug pricing', 'free bookkeeping software freelancer netherlands', 'zzp bookkeeping cost', 'retention obligation 7 years'],
  alternates: {
    canonical: '/en/prijzen',
    languages: { 'nl-NL': '/prijzen', 'en-GB': '/en/prijzen', ar: '/ar/prijzen', 'tr-TR': '/tr/prijzen' },
  },
  openGraph: {
    title: 'BoekBrug — try it free, run your business on Plus',
    description:
      `Plus costs ${PLUS.priceLabel} per month or ${PLUS.annualPriceLabel} per year — ` +
      `twelve months for the price of nine.`,
    type: 'website',
    locale: 'en_GB',
  },
}

const wrap: React.CSSProperties = { maxWidth: 880, margin: '0 auto', padding: '0 16px' }
const card: React.CSSProperties = { background: '#fff', border: '1px solid #e0e0e0', borderRadius: 16, padding: 24, boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }

// Only features that exist in the app today — kept honest, same list as NL.
const INCLUDED = [
  'Create, send and follow up invoices (with payment request)',
  'Scan receipts and purchase invoices with AI',
  'Automatically fetch invoices from your email',
  'Import a bank statement and match it automatically',
  'Cash book and daily turnover',
  'Prepare your VAT return (incl. the KOR small-business scheme)',
  'The bridge to your accountant — one button, everything complete',
  'The compliance vault: your admin ordered and exportable per year',
]

export default function EnPricingPage() {
  const ai = fairUseLimit('aiDocuments')
  const otherLimits = FAIR_USE_LIMITS.length - 1

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8f9fa', fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
      <PublicHeader />

      <main style={{ ...wrap, paddingTop: 40, paddingBottom: 64 }}>
        <p style={{ fontSize: 14, margin: '0 0 12px' }}>
          <Link href="/prijzen" style={{ color: '#1a73e8', textDecoration: 'none', fontWeight: 600 }}>🇳🇱 Bekijk in het Nederlands →</Link>
        </p>
        <h1 style={{ fontSize: 32, fontWeight: 700, color: '#202124', margin: '0 0 8px', lineHeight: 1.25 }}>
          You don&apos;t have to do bookkeeping. <span style={{ color: '#1a73e8' }}>You only have to not lose anything.</span>
        </h1>
        <p style={{ fontSize: 17, color: '#5f6368', margin: '0 0 16px', lineHeight: 1.6, maxWidth: 640 }}>
          Photograph your receipts or let them arrive by email; at the end of the quarter everything is ready for your accountant.
        </p>
        <p style={{ fontSize: 17, color: '#5f6368', margin: '0 0 28px', lineHeight: 1.6, maxWidth: 620 }}>
          You try it <strong>free</strong>, and your accountant works with you for free. No trial that quietly ends, no credit card up front, and no lock on your own administration.
        </p>

        {/* Three plans */}
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <section style={{ ...card, borderColor: '#137333', borderWidth: 2 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#137333', letterSpacing: 0.4, textTransform: 'uppercase' }}>Freelancer</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '10px 0 4px' }}>
              <span style={{ fontSize: 40, fontWeight: 700, color: '#202124' }}>€ 0</span>
            </div>
            <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>all features, to try out</div>
            <Link href="/register" style={{ display: 'block', textAlign: 'center', padding: '12px 20px', background: '#137333', color: '#fff', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 15 }}>Start for free</Link>
            <ul style={{ fontSize: 13.5, color: '#3c4043', margin: '16px 0 0', paddingInlineStart: 18, lineHeight: 1.7 }}>
              <li>Invoices sent: <strong>{fairUseLimit('invoicesSent').free} per month</strong></li>
              <li>Documents read by the AI: <strong>{fairUseLimit('aiDocuments').free} per month</strong></li>
              <li>Storage: <strong>{fairUseLimit('storageMb').free} MB</strong></li>
              <li>Linked mailbox: <strong>{fairUseLimit('mailboxes').free}</strong></li>
            </ul>
            <p style={{ fontSize: 13.5, color: '#5f6368', margin: '12px 0 0', lineHeight: 1.6 }}>
              Enough to see how it works. Run your business on it and you will pass these — that is the design. Everything you enter stays yours, after that too.
            </p>
          </section>

          <section style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1A73E8', letterSpacing: 0.4, textTransform: 'uppercase' }}>{PLUS.name}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '10px 0 4px' }}>
              <span style={{ fontSize: 40, fontWeight: 700, color: '#202124' }}>{PLUS.priceLabel}</span>
              <span style={{ fontSize: 15, color: '#5f6368' }}>per month</span>
            </div>
            <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>incl. VAT · cancel monthly</div>
            <p style={{ fontSize: 14.5, fontWeight: 600, color: '#188038', margin: '0 0 12px' }}>
              Or {PLUS.annualPriceLabel} per year — twelve months for the price of nine.
            </p>
            <SubscribeButton />
            <p style={{ fontSize: 13.5, color: '#5f6368', margin: '16px 0 0', lineHeight: 1.6 }}>
              {/* [EERLIJK-WOORD] This said "Plus raises every limit to {ai.plus}". Since Plus
                  publishes no ceiling, ai.plus is 0 — so that sentence rendered "raises every
                  limit to 0", the strictest number imaginable in the place the widest promise
                  belongs. A raw limit value never belongs in a sentence; formatLimit exists for
                  exactly this. */}
              This is the plan to run your business on. No published ceiling on invoices, AI-read documents or storage — generous, under fair use. Two mailboxes instead of one. Above {ai.free} AI-read documents a month, Plus is the answer.
            </p>
          </section>

          <section style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#5f6368', letterSpacing: 0.4, textTransform: 'uppercase' }}>Accountant</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '10px 0 4px' }}>
              <span style={{ fontSize: 40, fontWeight: 700, color: '#202124' }}>€ 0</span>
            </div>
            <div style={{ fontSize: 14, color: '#5f6368', marginBottom: 16 }}>always, regardless of the number of clients</div>
            <Link href="/register" style={{ display: 'block', textAlign: 'center', padding: '12px 20px', background: '#fff', color: '#1A73E8', border: '1.5px solid #1A73E8', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 15 }}>Open the portal</Link>
            <p style={{ fontSize: 13.5, color: '#5f6368', margin: '16px 0 0', lineHeight: 1.6 }}>
              The full portal, the work board and fetching a closed quarter per client. There is no paid accountant plan, and there won&apos;t be one.
            </p>
          </section>
        </div>

        {/* What's in everything */}
        <section style={{ ...card, marginTop: 16 }}>
          <h2 style={{ fontSize: 17, fontWeight: 700, color: '#202124', margin: '0 0 14px' }}>This is in every plan — including the free one</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
            {INCLUDED.map((feature) => (
              <li key={feature} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 14.5, color: '#202124', lineHeight: 1.5 }}>
                <span aria-hidden style={{ color: '#137333', fontWeight: 700, flexShrink: 0 }}>✓</span>
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 13.5, color: '#5f6368', margin: '16px 0 0', lineHeight: 1.6 }}>
            The limits are published to the number on <Link href="/eerlijk-gebruik" style={{ color: '#1A73E8' }}>/eerlijk-gebruik</Link>. If you exceed one, only the action that costs us money pauses. Viewing, searching and exporting your own administration always keep working — above the limit, and after you stop.
          </p>
        </section>

        {/* The Retention Vault */}
        <section style={{ ...card, marginTop: 16, background: '#FFFBF2', borderColor: '#E8C89A' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#7C5800', letterSpacing: 0.4, textTransform: 'uppercase' }}>BoekBrug Retention Vault</div>
          <h2 style={{ fontSize: 21, fontWeight: 700, color: '#202124', margin: '8px 0 10px' }}>You stop your business. Your retention obligation does not.</h2>
          <p style={{ fontSize: 15.5, color: '#3c4043', margin: '0 0 14px', lineHeight: 1.65, maxWidth: 660 }}>
            The Dutch tax office requires you to be able to show your administration for <strong>{BEWAARPLICHT_YEARS} years</strong> (art. 52 AWR). That term continues after your business stops — and after your software stops. It is the one thing an entrepreneur must still be able to do after quitting everything, and it is exactly where nothing is usually ready.
          </p>
          <p style={{ fontSize: 15.5, color: '#3c4043', margin: '0 0 14px', lineHeight: 1.65, maxWidth: 660 }}>
            We keep your archive online: ordered per year and quarter, searchable, and exportable per year with one button as a ZIP with an index. That costs <strong>{eur(KLUIS_PREPAY_YEAR_PRICE_EUR)} per remaining retention year</strong>, paid once in advance. Close your business today and that is {eur(BEWAARPLICHT_YEARS * KLUIS_PREPAY_YEAR_PRICE_EUR)} for the whole term.
          </p>
          <p style={{ fontSize: 14, color: '#5f6368', margin: 0, lineHeight: 1.65, maxWidth: 660 }}>
            <strong>What we do not sell:</strong> we do not take over your retention obligation — it stays legally yours. We are your second copy, never your only one; download your own copy too. And for the first <strong>{KLUIS_GRACE_MONTHS} months after you cancel we keep everything for free</strong>, with an email warning well before anything ever leaves. <Link href="/voorwaarden" style={{ color: '#1A73E8' }}>Terms §5.7</Link>.
          </p>
        </section>

        {/* FAQ */}
        <section style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#202124', margin: '0 0 16px' }}>Frequently asked questions</h2>
          <div style={{ display: 'grid', gap: 14 }}>
            <Faq q="Is the free plan a trial?">
              No clock runs. The free plan never stops by itself and you leave no payment details, so nothing can ever be charged. What it bounds is the amount per month: {fairUseLimit('invoicesSent').free} invoices sent and {ai.free} documents read by the AI. That is enough to see how BoekBrug works and too little to run a year on — by design. All {otherLimits + 1} limits are on <Link href="/eerlijk-gebruik" style={{ color: '#1A73E8' }}>one page</Link>.
            </Faq>
            <Faq q="What does Plus cost per year?">
              {PLUS.annualPriceLabel} per year incl. VAT — twelve months for the price of nine, paid up front. Exactly the same Plus as the {PLUS.priceLabel} monthly one: no different package and no different limits. One amount per year, with no free-months construction inside it.
            </Faq>
            <Faq q="What happens if I exceed fair use?">
              You get a notice at 80% of a limit, with the exact number — so before anything happens. If you exceed it, <em>only</em> the action that costs us money pauses: reading a new document automatically, sending a new invoice. Everything already there stays readable and exportable. Then you choose: wait for next month, or take Plus.
            </Faq>
            <Faq q="Does my accountant pay too?">
              No, and that will not change. The accountant portal is free, even with a hundred linked clients. There is no paid accountant plan.
            </Faq>
            <Faq q="Can I cancel monthly?">
              Yes. You cancel Plus yourself in your own settings — no email, no phone call. You keep Plus until the end of the period you already paid, and then fall back to the free plan. You lose no data: nothing is deleted, your mailbox stays connected, and everything stays readable and exportable. Only new growth beyond the free limits pauses.
            </Faq>
            <Faq q="Do I get an invoice with VAT?">
              Yes. Every payment automatically produces a VAT invoice in your name that you can download yourself. If you have a VAT number, you add it at checkout.
            </Faq>
            <Faq q="How can I pay?">
              With iDEAL or credit card. Payment runs via Stripe — your card details never reach BoekBrug.
            </Faq>
            <Faq q="What if I stop with BoekBrug entirely?">
              You export everything (that always keeps working, also on the free plan). After that we keep your administration free for another {KLUIS_GRACE_MONTHS} months. Want it to stay longer because your retention obligation continues? That is what the Retention Vault is for. We never delete anything without at least 30 days&apos; notice by email.
            </Faq>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  )
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#202124', marginBottom: 6 }}>{q}</div>
      <div style={{ fontSize: 15, color: '#5f6368', lineHeight: 1.6 }}>{children}</div>
    </div>
  )
}
