// src/lib/social-copy.test.ts
// [SOCIAL-CONTROLE] Every rule is tested against the sentence it was written to catch.
//
// The sentences below are verbatim from the thirty-day plan the audit rejected. That is the point:
// a blocklist whose entries are never exercised is a blocklist that quietly stops matching after
// someone edits a regex — the same failure AGENTS.md describes for a lifecycle gate that cuts on a
// comment. Two of these were already caught here rather than in review: a [^.] class that stopped
// at a sentence break, and an alternation for "één" that did not know the copy writes "Eén".

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPosts, interfaceVocabulary, FORBIDDEN, type SocialPost } from './social-copy'

function post(over: Partial<SocialPost> = {}): SocialPost {
  return {
    id: 'test', platform: 'instagram', format: 'carousel',
    slides: [], caption: '', cta: '', uiTerms: [], asset: 'none', ...over,
  }
}

const VOCAB = interfaceVocabulary()

/** Each entry: the rule must fire on this sentence from the rejected plan. */
const REJECTED: Array<[string, string]> = [
  ['a retired promise', 'Geen proefperiode, geen klok.'],
  ['a screen that does not exist', 'Bij Financieel overzicht zie je je omzet.'],
  ['a screen named wrongly', 'Inkomende facturen komen klaar te staan.'],
  ['the wrong word for a numbering series', 'BoekBrug geeft automatisch een opvolgend factuurnummer.'],
  ['an English name for a Dutch screen', 'Probeer de gratis invoice creator.'],
  ['a quota we do not offer', 'Onbeperkt scannen, altijd.'],
  ['a bank link we cannot deliver', 'Met de directe bankkoppeling staat alles er vanzelf in.'],
  ['a format we do read', 'Een gewone CSV of PDF kan wel worden bewaard, maar wordt niet als transacties ingelezen.'],
  ['a click that was removed on purpose', 'Klant akkoord? Eén klik. Offerte wordt factuur.'],
  ['a feature that has no screen', 'Je kunt op het startscherm in gewone taal beschrijven wat je hebt gedaan.'],
  ['control the app does not leave to the user', 'Jij controleert alles.'],
  ['a privacy promise narrower than the grant', 'We lezen alleen factuur-bijlagen. Nooit persoonlijke e-mails.'],
  ['filing we never do', 'BoekBrug dient je aangifte in bij de Belastingdienst.'],
  ['a promise beyond the boundary', 'Het kwartaal doet zichzelf.'],
  ['automation stated without limit', 'Je administratie wordt volledig automatisch bijgewerkt.'],
]

for (const [what, sentence] of REJECTED) {
  test(`[SOCIAL-CONTROLE] refuses ${what}`, () => {
    const findings = checkPosts([post({ caption: sentence })], VOCAB)
    assert.ok(
      findings.some((f) => f.rule === 'FORBIDDEN'),
      `nothing caught: ${sentence}`,
    )
  })
}

test('[SOCIAL-CONTROLE] every rule is exercised by at least one sentence above', () => {
  // A rule nobody tests is a rule that can stop matching without anyone noticing.
  for (const rule of FORBIDDEN) {
    assert.ok(
      REJECTED.some(([, s]) => rule.pattern.test(s)),
      `no test sentence for /${rule.pattern.source}/`,
    )
  }
})

test('[SOCIAL-CONTROLE] a term the app really shows passes', () => {
  // Not "Kwartaal" any more: that one is on the accountant's bar, and the rule below refuses it.
  const findings = checkPosts(
    [post({ slides: ['Je facturen staan klaar onder Inkomend.'], uiTerms: ['Inkomend'] })],
    VOCAB,
  )
  assert.deepEqual(findings, [], JSON.stringify(findings))
})

test('[SOCIAL-CONTROLE] a term the app does not show is refused', () => {
  // Not "Openstaand": that one is real (kw.openstaand, lijst.kop.openstaand and two more), and
  // writing this test proved an earlier audit finding wrong — the word exists as a heading and a
  // tile; only the invoice list's TAB is called Verzonden. The gate is the thing that settles it.
  const findings = checkPosts(
    [post({ slides: ['Kijk bij Overzichtspaneel.'], uiTerms: ['Overzichtspaneel'] })],
    VOCAB,
  )
  assert.ok(findings.some((f) => f.rule === 'UNKNOWN-TERM'), JSON.stringify(findings))
})

test('[SOCIAL-CONTROLE] a declaration that is no longer in the copy is refused', () => {
  const findings = checkPosts([post({ slides: ['Iets anders.'], uiTerms: ['Inkomend'] })], VOCAB)
  assert.ok(findings.some((f) => f.rule === 'UNUSED-TERM'), JSON.stringify(findings))
})

test('[SOCIAL-CONTROLE] interface text quoted but not declared is refused', () => {
  const findings = checkPosts([post({ slides: ['Druk op «Verstuur maar».'] })], VOCAB)
  assert.ok(findings.some((f) => f.rule === 'UNDECLARED'), JSON.stringify(findings))
})

test('[SOCIAL-CONTROLE] the vocabulary really came from the app', () => {
  // Guards the load-bearing import: if MESSAGES ever stops being read, every term would pass.
  assert.ok(VOCAB.size > 1000, `vocabulary looks empty: ${VOCAB.size}`)
  assert.ok(VOCAB.has('verzonden'), 'a known interface word is missing from the vocabulary')
})

test("[SOCIAL-CONTROLE] a label from the accountant's navigation is refused for an owner post", () => {
  // The mistake that earned this rule: "Kwartaal" is a real interface word, so the vocabulary
  // check passed a draft that sent a zzp'er to a tab only a boekhouder has.
  const findings = checkPosts(
    [post({ slides: ['Kijk aan het eind bij Kwartaal.'], uiTerms: ['Kwartaal'] })],
    VOCAB,
  )
  assert.ok(findings.some((f) => f.rule === 'WRONG-AUDIENCE'), JSON.stringify(findings))
})
