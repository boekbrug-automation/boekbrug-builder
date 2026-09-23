'use client'

// src/components/intake/IntakeProgress.tsx
// [INTAKE-VOORTGANG] What is happening to the file the owner just handed over.
//
// The add-button closed its sheet the moment a file was picked, and from then on the only sign
// of life was an hourglass on the card and "wordt gelezen (1)" in small type. A read takes
// seconds, sometimes tens of them; the owner asked for a dialog with a progress bar, one they can
// close while the upload goes on. This is that dialog.
//
// ── THE BAR IS HONEST ──
//
// An upload has three phases and only ONE of them has a percentage:
//   · fitting  — the file is made to fit the upload (re-encoded, compressed). No known length.
//   · uploading — bytes leave the phone. The browser reports how many; this is the percentage.
//   · reading  — the server reads the document. No known length either, and it is the long one.
// A bar that keeps filling during the read would be inventing progress. So the bar is a number
// while bytes move and an indeterminate slide otherwise, with aria-valuenow only where there is a
// value — a screen reader must not be told "40%" of something that has no forty percent.
//
// ── IT HOLDS NO LANGUAGE ──
//
// Every word is handed in: the title, the phase under each row, the outcome, the X's label, the
// footnote. The add-button resolves them from the catalogue in the owner's language.
//
// ── CLOSING IT CHANGES NOTHING ──
//
// The X only hides the dialog; the upload is the add-button's, not this component's, and it runs
// on. The gate holds that nothing here can reach the request.

import { M3, FONT, sheetPaddingBottom } from '@/lib/design/tokens'
import { DismissX } from '@/components/ui/DismissX'
// [BACK-CLOSES] The system back button closes this dialog, like every other overlay in the app —
// otherwise "back" leaves the page behind the dialog, with the upload's outcome still to come.
import { useCloseOnBack } from '@/lib/use-close-on-back'

// [ONTVANGEN-WAAR] 'received' sits between 'reading' and 'done', and is neither.
//
// The bar is FULL — the handoff finished, the owner may walk away, and a bar left hanging would
// say the opposite. But the colour is not the green of a finished read, because what the reader
// will make of the file is not known at this moment and this row may not imply that it is.
export type ProgressPhase = 'fitting' | 'uploading' | 'reading' | 'received' | 'done' | 'failed'

export interface ProgressRow {
  id: string
  name: string
  phase: ProgressPhase
  /** 0–100, meaningful while uploading only. */
  percent: number
  /** The phase, in the owner's words. */
  phaseLabel: string
  /** Where it landed, once known — in the owner's words. */
  outcome?: string
}

export function IntakeProgress({ open, title, rows, closeLabel, footnote, onClose }: {
  open: boolean
  title: string
  rows: ProgressRow[]
  closeLabel: string
  footnote: string
  onClose: () => void
}) {
  // Before the early return: a hook may not sit behind a condition.
  useCloseOnBack(open && rows.length > 0, onClose)
  if (!open || rows.length === 0) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0,
        // Below the outcome dialogs (400): a duplicate's decision or a file's destination lands
        // ON TOP of the progress it followed, never behind it.
        zIndex: 350,
        background: 'rgba(32,33,36,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        // The same reservation the feedback dialog makes: the BottomNav paints above this overlay.
        padding: 16, paddingBottom: sheetPaddingBottom(16),
        fontFamily: FONT,
      }}
    >
      <div style={{ background: '#fff', width: '100%', maxWidth: 440, borderRadius: 16, padding: 16, boxSizing: 'border-box', boxShadow: '0 12px 40px rgba(0,0,0,0.22)', maxHeight: '100%', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ flex: 1, minWidth: 0, fontSize: 15, color: M3.onSurface }}>{title}</strong>
          <DismissX label={closeLabel} onClick={onClose} />
        </div>
        <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((r) => {
            const determinate = r.phase === 'uploading'
            // [ONTVANGEN-WAAR] A received row is FULL (the handoff is over) and PRIMARY (the read
            // is not). Only a genuinely finished outcome earns the green.
            const full = r.phase === 'done' || r.phase === 'failed' || r.phase === 'received'
            const indeterminate = r.phase === 'fitting' || r.phase === 'reading'
            const fill = r.phase === 'failed' ? M3.error : r.phase === 'done' ? M3.success : M3.primary
            return (
              <li key={r.id}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: M3.onSurface, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'start' }}>{r.name}</span>
                  <span style={{ flexShrink: 0, fontSize: 12, color: r.phase === 'failed' ? M3.error : M3.mutedText }}>{r.phaseLabel}</span>
                </div>
                <div
                  className={indeterminate ? 'progress-track progress-indeterminate' : 'progress-track'}
                  role="progressbar"
                  aria-label={r.name}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={determinate ? r.percent : full ? 100 : undefined}
                  style={{ marginTop: 6 }}
                >
                  {!indeterminate && (
                    <div className="progress-fill" style={{ width: `${full ? 100 : Math.max(0, Math.min(100, r.percent))}%`, background: fill }} />
                  )}
                </div>
                {r.outcome && (
                  <p style={{ fontSize: 12, color: M3.neutral, margin: '5px 0 0', lineHeight: 1.4, textAlign: 'start' }}>{r.outcome}</p>
                )}
              </li>
            )
          })}
        </ul>
        <p style={{ fontSize: 12, color: M3.mutedText, margin: '12px 0 0', lineHeight: 1.45, textAlign: 'start' }}>{footnote}</p>
      </div>
    </div>
  )
}
