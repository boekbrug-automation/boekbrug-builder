// src/lib/social-copy.ts
// [SOCIAL-CONTROLE] The rules that decide whether a marketing post may be published.
//
// A thirty-day campaign was drafted against this product and audited twice. The first pass found
// 220 claims that were not true of the app. The corrections to those claims introduced 206 NEW
// untrue ones and 95 screen names the app does not use. The rate did not fall between rounds, and
// that is the finding: each round writes fresh prose about a product whose behaviour is precise,
// and fresh prose invents. Reviewing harder does not repair a process that re-derives the facts
// every time it runs.
//
// What does not drift is text the product already owns — belofte.ts for the promise, messages.ts
// for every word on a screen. So this file applies the rule AGENTS.md already states for the
// interface to marketing as well:
//
//     A sentence that points at a button names the button as it is written.
//
// A post DECLARES the interface terms it names, in `uiTerms`, and checkPosts proves each one
// exists. Guessing which words in a Dutch sentence are button names is unreliable; making the
// author declare them is not, and the declaration is what a reviewer should read first anyway.
//
// WHAT IT CANNOT DO: it does not know whether a post is true. It knows whether the post names
// things that exist and whether it repeats a sentence already established as false. Those two
// classes cover every defect the audit found more than once. The rest still needs a human.

import { MESSAGES } from './i18n/messages'

export interface SocialPost {
  id: string
  platform: 'instagram' | 'linkedin'
  format: string
  /** On-image text, one entry per slide. */
  slides: string[]
  caption: string
  cta: string
  /**
   * Every interface term this post names — a screen, a tab, a button, a field.
   *
   * Written exactly as the post writes it. The check is deliberately exact: "Inkomende facturen"
   * for a screen called "Inkomend" is the defect, not a near miss.
   */
  uiTerms: string[]
  /** Which screenshot or clip it needs, and whether that needs a logged-in tenant. */
  asset: string
}

export interface CopyFinding {
  post: string
  rule: 'FORBIDDEN' | 'UNKNOWN-TERM' | 'UNUSED-TERM' | 'UNDECLARED' | 'WRONG-AUDIENCE'
  what: string
  why: string
  evidence: string
}

/**
 * Sentences settled as untrue, retired or forbidden — each with the reason attached.
 *
 * Every entry cost a verification round to establish, so the reason travels with the pattern. A
 * bare blocklist gets deleted by the next person who thinks it is over-strict.
 */
export const FORBIDDEN: ReadonlyArray<{ pattern: RegExp; why: string; evidence: string }> = [
  {
    pattern: /geen proefperiode|proefperiode die afloopt/i,
    why: 'Retired on purpose: a new account has the Plus limits for 90 days and then the free plan.',
    evidence: 'src/lib/belofte.ts [WELKOM-90] — use BELOFTE_GERUST',
  },
  {
    pattern: /financieel overzicht/i,
    why: 'No screen by that name exists; it survives only in comments about its removal.',
    evidence: '/dashboard/resultaat is a bare redirect',
  },
  {
    pattern: /inkomende facturen/i,
    why: 'The screen is called Inkomend. A reader sent to find "Inkomende facturen" finds no such label.',
    evidence: 'src/lib/i18n/messages.ts nav.incoming',
  },
  {
    pattern: /opvolgend factuurnummer/i,
    why: 'Wrong word: a numbering series is doorlopend; opvolgend means succeeding a person.',
    evidence: "content/blog/nl/factuur-eisen.mdx — 'netjes en doorlopend'",
  },
  {
    pattern: /invoice creator|invoice generator/i,
    why: 'English name for a Dutch screen. Dutch is the source language of everything on screen.',
    evidence: 'AGENTS.md — Dutch on the screen',
  },
  {
    pattern: /volledig automatisch|geheel automatisch/i,
    why: 'The app books the confident cases itself, never the whole administratie.',
    evidence: 'terms §4.3 — an AI outcome is a suggestion, never a fact',
  },
  {
    pattern: /onbeperkt (scannen|lezen|uitlezen|documenten)/i,
    why: 'There is a quota: 50 AI-read documents a month free, 500 on Plus, 3 a day on the public scan.',
    evidence: 'src/lib/ai-budget.ts',
  },
  {
    pattern: /directe bankkoppeling|bank koppelen aan je rekening/i,
    why: 'The PSD2 integration is built but not contracted, and the panel hides itself.',
    evidence: 'src/app/dashboard/bank/BankConnectPanel.tsx:243',
  },
  {
    pattern: /CSV[\s\S]{0,60}(niet|geen)[\s\S]{0,40}(ingelezen|transacties)/i,
    why: 'CSV bank statements ARE parsed, and boekbrug.nl/tools says so itself.',
    evidence: 'src/lib/bank-csv.ts, src/lib/intake-router.ts',
  },
  {
    // Two traps in one line, both found by running this gate against the copy it must catch.
    // A [^.] class stops at the sentence break, and the copy writes it as two sentences ("Klant
    // akkoord? Eén klik. Offerte wordt factuur."). And "één" has three spellings in the wild —
    // één, eén and een — so an alternation listing two of them matched none of the real text.
    pattern: /[eé][eé]n klik[\s\S]{0,40}offerte|offerte[\s\S]{0,30}[eé][eé]n klik/i,
    why: 'One-click offerte-to-factuur was removed on purpose and a test guards the removal; you get a pre-filled form.',
    evidence: 'src/app/dashboard/facturen/FacturenClient.tsx',
  },
  {
    pattern: /in gewone taal|beschrijf wat je hebt gedaan|AI (de |je )?factuur (alvast )?in(vullen|vult)/i,
    why: 'There is no natural-language-to-invoice feature: generateInvoiceFromPrompt has no caller and no route.',
    evidence: "src/lib/ai.ts:3163 — 'dus onbereikbare code' (src/lib/ai.ts:16)",
  },
  {
    pattern: /jij controleert alles|je controleert elke|jij houdt het laatste woord/i,
    why: 'The app books a clear invoice, a kassabon with a printed tender line and an exact bank match without a tap.',
    evidence: 'src/lib/bank-matching.ts, src/app/api/intake/route.ts',
  },
  {
    pattern: /alleen factuur-?bijlagen|nooit persoonlijke e-?mails/i,
    why: 'The mailbox grant is read access to the whole mailbox with an internal filter. Never promise less than we ask for.',
    evidence: 'src/lib/email-integration.ts',
  },
  {
    pattern: /dient (je |de )?aangifte in|aangifte indienen bij de belastingdienst/i,
    why: 'The app prepares and exports; it never files. Implying otherwise is a regulator-facing claim.',
    evidence: "src/lib/belofte.ts — 'staat klaar', never 'is gedaan'",
  },
  {
    pattern: /het kwartaal doet zichzelf|je boekhouding doet zichzelf/i,
    why: 'Explicitly out of bounds for the promise.',
    evidence: 'src/lib/belofte.ts — DE GRENS VAN DE BELOFTE',
  },
]

/**
 * Navigation labels that belong to the ACCOUNTANT's screens and not the owner's.
 *
 * Earned by a mistake this gate let through. A draft told a zzp'er to look at "Kwartaal"; the word
 * is real, so the vocabulary check passed it — but nav-destinations.ts puts it in ACCOUNTANT, and
 * the owner's bar is Start · Facturen · Vandaag · Inkomend · Bestanden. The owner would hunt for a
 * tab that is not on their screen, which is the exact failure the vocabulary check exists to stop.
 *
 * So existence is not the whole question. WHOSE screen it is on matters too, and a campaign aimed
 * at zzp'ers may not send them to the boekhouder's navigation.
 */
export const ACCOUNTANT_ONLY_NAV = ['kwartaal', 'klanten'] as const

/** Every Dutch string the interface can show, lowercased. Extra labels may be passed in. */
export function interfaceVocabulary(extra: Iterable<string> = []): Set<string> {
  const words = new Set<string>()
  for (const m of Object.values(MESSAGES) as Array<{ nl: string }>) {
    if (m && typeof m.nl === 'string') words.add(m.nl.trim().toLowerCase())
  }
  for (const e of extra) words.add(e.trim().toLowerCase())
  return words
}

export function checkPosts(posts: SocialPost[], vocabulary: Set<string>): CopyFinding[] {
  const findings: CopyFinding[] = []

  for (const post of posts) {
    const text = [...post.slides, post.caption, post.cta].join('\n')

    for (const rule of FORBIDDEN) {
      const hit = rule.pattern.exec(text)
      if (hit) {
        findings.push({ post: post.id, rule: 'FORBIDDEN', what: hit[0].slice(0, 90), why: rule.why, evidence: rule.evidence })
      }
    }

    for (const term of post.uiTerms) {
      const normalised = term.trim().toLowerCase()
      if (!vocabulary.has(normalised)) {
        findings.push({
          post: post.id, rule: 'UNKNOWN-TERM', what: term,
          why: 'The post names this as something on screen, but the app never shows that text.',
          evidence: 'src/lib/i18n/messages.ts',
        })
      }
      if ((ACCOUNTANT_ONLY_NAV as readonly string[]).includes(normalised)) {
        findings.push({
          post: post.id, rule: 'WRONG-AUDIENCE', what: term,
          why: "That label is on the accountant's navigation, not the owner's (Start · Facturen · Vandaag · Inkomend · Bestanden).",
          evidence: 'src/lib/nav-destinations.ts — OWNER vs ACCOUNTANT',
        })
      }
      if (!text.toLowerCase().includes(normalised)) {
        findings.push({
          post: post.id, rule: 'UNUSED-TERM', what: term,
          why: 'Declared in uiTerms but absent from the copy — the declaration has gone stale.',
          evidence: post.id,
        })
      }
    }

    // Anything quoted with «» is a claim about the interface and must be declared.
    for (const m of text.matchAll(/«([^»]+)»/g)) {
      if (!post.uiTerms.some((t) => t.trim().toLowerCase() === m[1].trim().toLowerCase())) {
        findings.push({
          post: post.id, rule: 'UNDECLARED', what: m[1],
          why: 'Quoted as interface text but not listed in uiTerms, so nothing checked it.',
          evidence: post.id,
        })
      }
    }
  }

  return findings
}
