// src/components/public-header.tsx
// [LANDING] Shared public header: BoekBrug wordmark + the three public nav
// links (Gratis tools / Inloggen / Gratis account). Reuses the exact look of
// the original inline header on the landing page — sticky, blurred, #1a73e8
// primary button — so every public/tool page shares one consistent top bar.

import Link from 'next/link'
import { BetaBadge } from '@/components/beta'

const wrap: React.CSSProperties = { maxWidth: 980, margin: '0 auto', padding: '0 20px' }
const btnPrimary: React.CSSProperties = { backgroundColor: '#1a73e8', color: '#fff', fontWeight: 600, borderRadius: 9999, textDecoration: 'none', display: 'inline-block', padding: '9px 18px', fontSize: 14 }

export default function PublicHeader() {
  return (
    <header style={{ background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(20px)', borderBottom: '1px solid #e0e0e0', position: 'sticky', top: 0, zIndex: 10 }}>
      <div className="public-header-wrap" style={{ ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
        {/* [BETA] The name, and beside it the one word that says the product is still moving.
            Dutch here because the public pages are Dutch; inside the app the badge follows the
            owner's language setting (kop.beta). */}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <Link href="/" className="public-nav-brand" style={{ fontSize: 20, fontWeight: 800, color: '#202124', textDecoration: 'none', letterSpacing: -0.5, whiteSpace: 'nowrap' }}>BoekBrug</Link>
          <BetaBadge label="Bèta" />
        </span>
        {/* [PUBLIC-NAV] Five links in one non-wrapping row overflowed every
            public page on a phone: at 390px the nav measured 385px starting at
            x=104, so it ran 99px past the right edge and "Gratis account maken"
            — the one conversion button on the whole site — sat off-screen where
            nobody could reach it. These are the SEO landing pages, which is
            where most first visits arrive, and most of those are on a phone.

            Below 640px the three browsing links collapse (`public-nav-wide`);
            Inloggen and the signup button always stay, because those are the
            two things a visitor came to do. Nothing becomes unreachable: tools,
            blog and the English blog all sit in the footer of every page.
            Same breakpoint and same mechanism as the dashboard's
            .dash-nav-links, so the two headers behave alike. */}
        <nav style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Link className="public-nav-wide" href="/tools" style={{ fontSize: 15, color: '#202124', textDecoration: 'none', padding: '8px 12px', fontWeight: 500 }}>Gratis tools</Link>
          <Link className="public-nav-wide" href="/blog" style={{ fontSize: 15, color: '#202124', textDecoration: 'none', padding: '8px 12px', fontWeight: 500 }}>Blog</Link>
          {/* English-blog link — makes the /en/blog knowledge base reachable from
              every public page (home, tools, articles), not just the blog index. */}
          <Link className="public-nav-wide" href="/en/blog" aria-label="Read the blog in English" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 14, fontWeight: 600, color: '#1a73e8', background: '#e8f0fe', border: '1px solid #d3e3fd', borderRadius: 9999, textDecoration: 'none', padding: '6px 12px' }}>
            <span aria-hidden="true">🌐</span> EN
          </Link>
          <Link className="public-nav-login" href="/login" style={{ fontSize: 15, color: '#202124', textDecoration: 'none', padding: '8px 10px', fontWeight: 500, whiteSpace: 'nowrap' }}>Inloggen</Link>
          {/* The label sheds its last word on a narrow screen rather than being
              cut off: "Gratis account maken" → "Gratis account". Same link, same
              promise, one word shorter. Kept as a span so there is no second
              element to keep in sync, and so a screen reader still reads the
              full sentence at any width. */}
          <Link href="/register" style={btnPrimary} className="public-nav-cta">
            Gratis account<span className="public-nav-cta-tail"> maken</span>
          </Link>
        </nav>
      </div>
    </header>
  )
}
