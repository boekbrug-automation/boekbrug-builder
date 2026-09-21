'use client'

// src/components/kantoor/Aandachtspunten.tsx
// [KANTOOR-PERIODE] The known work, at the top of the client's quarter.
//
// WHAT IT PUTS ON THE SCREEN
//
// Four spans, in one fixed order, each with the findings its own source produced. It holds no
// language of its own beyond four structural labels — every diagnosis is the sentence readiness,
// the money rule or the numbering check already wrote. Handing it a finding it cannot name is
// impossible: there is no branch here that composes one.
//
// AND WHAT IT REFUSES TO PUT THERE
//
//   · NO COUNT over the whole block. Four sources fail independently, so "3 aandachtspunten" is a
//     correct number about a possibly incomplete set — the readiness score's defect, repeated.
//     The per-group "+N meer" is a different thing: it counts a list that WAS read, in full.
//   · NO GREEN CARD when everything is clean. A box the size of a warning, in the spot a warning
//     will one day appear, is how a reader learns to skim that spot. Clean and fully read is
//     SILENCE, and the figures below become the first thing on the screen.
//   · NO STATE. Nothing is ticked off, nothing is remembered, nothing is written. A finding
//     disappears when its own source stops reporting it, and never a moment sooner.
//
// The <details> folds are ephemeral browser state and deliberately not lifted anywhere.

import Link from 'next/link'

import { M3, R, EL1 } from '@/lib/design/tokens'
import type { Translator } from '@/lib/i18n/t'
import type { MessageKey } from '@/lib/i18n/messages'
import {
  hiddenGroupItemCount,
  scopeHasContent,
  workspaceHasContent,
  type ScopeView,
  type WorkItem,
  type WorkScope,
} from '@/lib/period-workspace'

/**
 * The heading of a span.
 *
 * The selected quarter is named by the period itself ("Q3 2026") — it is a date, not a sentence,
 * and it is how this app writes a quarter everywhere else. The other three say which OTHER span
 * they are about, because that is the fact a reader would otherwise get wrong.
 */
const SCOPE_LABEL: Record<Exclude<WorkScope, 'kwartaal'>, MessageKey> = {
  administratie: 'kw.werk.scope.administratie',
  nummering: 'kw.werk.scope.nummering',
  kas: 'kw.werk.scope.kas',
}

/** The one type size both halves of a Regel share; only the COLOUR says whether it leads anywhere. */
const REGEL_TEKST = { fontSize: 13.5, lineHeight: 1.55 } as const

function Regel({ item }: { item: WorkItem }) {
  // [KANTOOR-PERIODE] Actionable and not-actionable must be told apart WITHOUT reading the sentence.
  //
  // The two branches each carry their own colour on the element that holds the words, and there is
  // deliberately no shared child span between them. There used to be: one `tekst` span with
  // `color: M3.onSurface`, dropped inside an <a> that set `color: M3.primary`. The child wins in
  // CSS, so every item — the ones that open an exact screen and the ones with nowhere to go —
  // rendered in the same ink, and the accountant could only find the links by hovering the list.
  //
  // An item with no exact destination is TEXT, not a dead link: a finding about a bank line has no
  // accountant screen to open, and a greyed-out affordance would promise one that is not there.
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0' }}>
      <span
        aria-hidden
        style={{ width: 6, height: 6, borderRadius: '50%', background: M3.warn, flexShrink: 0, marginTop: 7 }}
      />
      {item.href ? (
        // next/link, so landing on the work is a client navigation inside the dashboard — the href
        // itself is exactly what Batch 2 proved, and it is still in the DOM for middle-click,
        // "open in new tab" and every test that reads it.
        <Link
          href={item.href}
          style={{
            ...REGEL_TEKST,
            color: M3.primary,
            fontWeight: 500,
            textDecoration: 'underline',
            textUnderlineOffset: 2,
          }}
        >
          {item.text}
        </Link>
      ) : (
        <span style={{ ...REGEL_TEKST, color: M3.onSurface }}>{item.text}</span>
      )}
    </div>
  )
}

function Blok({ view, t, kop }: { view: ScopeView; t: Translator; kop: string }) {
  if (!scopeHasContent(view)) return null
  const restGroepen = hiddenGroupItemCount(view)

  return (
    <section style={{ marginTop: 14 }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: M3.onSurfaceVariant, textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 0 4px' }}>
        {kop}
      </p>

      {/* [NO-SILENT-EMPTY] A source that could not answer says so HERE, beside whatever the other
          sources did find — never instead of them, and never as a silence that reads as "fine". */}
      {view.notices.map((zin) => (
        <p key={zin} role="alert" style={{ fontSize: 13, color: M3.warn, margin: '2px 0 6px', lineHeight: 1.55 }}>
          {zin}
        </p>
      ))}

      {view.groups.map((groep) => (
        <div key={groep.key}>
          {groep.shown.map((item) => (
            <Regel key={item.sourceIdentity} item={item} />
          ))}
          {groep.hidden.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 12.5, color: M3.primary, padding: '2px 0 4px' }}>
                {t('bh.werk.meer', { n: groep.hidden.length })}
              </summary>
              {groep.hidden.map((item) => (
                <Regel key={item.sourceIdentity} item={item} />
              ))}
            </details>
          )}
        </div>
      ))}

      {/* Beyond the ceiling on GROUPS: the rest of the span, folded once. Still every finding. */}
      {restGroepen > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 12.5, color: M3.primary, padding: '2px 0 4px' }}>
            {t('bh.werk.meer', { n: restGroepen })}
          </summary>
          {view.hiddenGroups.map((groep) => (
            <div key={groep.key}>
              {[...groep.shown, ...groep.hidden].map((item) => (
                <Regel key={item.sourceIdentity} item={item} />
              ))}
            </div>
          ))}
        </details>
      )}
    </section>
  )
}

export default function Aandachtspunten({
  views,
  t,
  kwartaalLabel,
}: {
  views: ScopeView[]
  t: Translator
  /** "Q3 2026" — the period itself, written the way every other accountant screen writes it. */
  kwartaalLabel: string
}) {
  // Everything clean and every source read → nothing at all. The figures move up and become the
  // first thing the accountant sees, which is the honest answer to "what is there to do here".
  if (!workspaceHasContent(views)) return null

  const perScope = new Map(views.map((v) => [v.scope, v]))

  return (
    <div style={{ background: M3.surface, borderRadius: R.lg, boxShadow: EL1, padding: '14px 16px' }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, color: M3.onSurface, margin: 0 }}>{t('kw.werk.kop')}</h2>

      {perScope.get('kwartaal') && (
        <Blok view={perScope.get('kwartaal')!} t={t} kop={kwartaalLabel} />
      )}
      {(['administratie', 'nummering', 'kas'] as const).map((scope) => {
        const view = perScope.get(scope)
        return view ? <Blok key={scope} view={view} t={t} kop={t(SCOPE_LABEL[scope])} /> : null
      })}
    </div>
  )
}
