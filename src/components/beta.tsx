// src/components/beta.tsx
// [BETA] BoekBrug says, calmly, that it is still in bèta.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
//
// The product changes fast, and a bookkeeping app that changes under someone's hands without
// saying so feels unreliable even when every change is an improvement. Saying it once, in the
// right two places, turns "this moved" from a surprise into something the owner was told about.
//
// ── WHAT IT MAY NOT LOOK LIKE ────────────────────────────────────────────────────────────────
//
// Not a warning. No red, no amber, no triangle, no border that shouts — those say "your
// administration may be unsafe", which is not what bèta means here and is not true. It is the
// app's own quiet blue, one shade lighter, at the size of a label rather than a banner.
//
// ── AND WHERE IT MAY NOT APPEAR ──────────────────────────────────────────────────────────────
//
// On every screen. A message repeated on twenty screens stops being read on the first and starts
// being noise on the rest ([RUSTIG]: a screen says what it is and offers what to do). So: the
// sentence stands once, on the public homepage, where someone decides whether to trust us; and
// inside the app there is only the badge beside the name, which is a fact, not a paragraph.
//
// ── A COMPONENT HOLDS NO LANGUAGE OF ITS OWN ─────────────────────────────────────────────────
//
// The badge renders the word it is handed. Inside the app that word comes from messages.ts and
// follows the owner's language; on the public pages, which are Dutch, it is the Dutch word. One
// hard-coded string here is how a translation stays permanently half-finished.

import * as React from 'react'

/**
 * The label beside the BoekBrug wordmark.
 *
 * Sized to sit next to a 17–20px wordmark without competing with it: small, uppercase, and in the
 * same blue the app uses for everything it is calm about.
 */
export function BetaBadge({ label, style }: { label: string; style?: React.CSSProperties }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.6px',
        lineHeight: 1,
        textTransform: 'uppercase',
        color: '#1a73e8',
        background: '#e8f0fe',
        border: '1px solid #d3e3fd',
        borderRadius: 9999,
        padding: '3px 7px',
        // The wordmark is the name; this is a note beside it. It must never be read as part of it.
        verticalAlign: 'middle',
        ...style,
      }}
    >
      {label}
    </span>
  )
}

/**
 * The homepage note. Three short lines, in the owner's own words, and nowhere else in the product.
 *
 * Kept as three paragraphs rather than one block on purpose: the first is the fact, the second is
 * what it means for the product, the third is what does NOT change. Somebody who reads only the
 * first line has still been told the thing that matters.
 */
export function BetaNotice() {
  return (
    <div
      role="note"
      style={{
        maxWidth: 980,
        margin: '0 auto',
        padding: '0 20px',
      }}
    >
      <div
        style={{
          background: '#f8fafd',
          border: '1px solid #e3e8f0',
          borderRadius: 14,
          padding: '16px 18px',
          marginTop: 20,
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <BetaBadge label="Bèta" style={{ marginTop: 2 }} />
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#202124', lineHeight: 1.5 }}>
            BoekBrug is momenteel in bèta.
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: '#5f6368', lineHeight: 1.6 }}>
            We verbeteren BoekBrug actief op basis van gebruik in de praktijk. Daardoor kunnen
            onderdelen nog veranderen of verder worden verfijnd.
          </p>
          <p style={{ margin: '6px 0 0', fontSize: 14, color: '#5f6368', lineHeight: 1.6 }}>
            Je administratie en documenten blijven daarbij ons uitgangspunt: veilig, duidelijk en
            zonder onnodig werk voor jou.
          </p>
        </div>
      </div>
    </div>
  )
}
