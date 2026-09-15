// [TAAL] Pure node test — run: npx tsx --test src/lib/i18n/i18n.test.ts
//
// The app already spoke four languages in its BLOG — 53 Arabic articles, an /ar/blog route, a
// locale table that knows Arabic is right-to-left. It spoke exactly one in the PRODUCT. An Arab
// shop owner in the Netherlands could read this app's writing in their own language, click
// through, and land in a Dutch application.
//
// What is tested here is not "does it translate". It is the three properties that decide whether
// a half-translated bookkeeping app is usable or dangerous:
//
//   · a gap falls back to something TRUE, never to a key and never to a blank;
//   · a translation cannot quietly lose a number, a name or an amount;
//   · Dutch does not change while the other languages are being added.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  LOCALES, DEFAULT_LOCALE, LOCALE_META, isLocale, resolveLocale, localeDir, localePrefix,
  type Locale,
} from './locale'
import { MESSAGES, type MessageKey } from './messages'
import { translate, translator } from './t'
import { invoiceSentNotice } from '../invoice-sent-notice'

const KEYS = Object.keys(MESSAGES) as MessageKey[]
const PLACEHOLDER = /\{(\w+)\}/g

function placeholders(s: string): string[] {
  return [...s.matchAll(PLACEHOLDER)].map((m) => m[1]).sort()
}

// ── the vocabulary ─────────────────────────────────────────────────────────────────────────────

test('[TAAL] every language has complete metadata, and Arabic is the right-to-left one', () => {
  for (const l of LOCALES) {
    const meta = LOCALE_META[l]
    assert.ok(meta, `${l} has no metadata`)
    for (const field of ['dir', 'label', 'hreflang', 'ogLocale', 'intl'] as const) {
      assert.ok(meta[field], `${l}.${field} is empty`)
    }
  }
  assert.equal(LOCALE_META.ar.dir, 'rtl')
  assert.equal(localeDir('ar'), 'rtl')
  for (const l of ['nl', 'en', 'tr'] as Locale[]) assert.equal(localeDir(l), 'ltr')
})

test('[TAAL] Arabic formats money with Latin digits, on purpose', () => {
  // ar-u-nu-latn, and it is a product decision, not a default. The owner reconciles these figures
  // against a Dutch bank statement and a Dutch invoice; Eastern Arabic numerals would be correct
  // as language and wrong as money. Losing the subtag would silently change every amount on
  // screen into digits that match nothing the owner is comparing them to.
  assert.match(LOCALE_META.ar.intl, /-u-nu-latn$/)
  const formatted = new Intl.NumberFormat(LOCALE_META.ar.intl, {
    style: 'currency', currency: 'EUR',
  }).format(1234.56)
  assert.match(formatted, /1/, 'the digits must be the ones a Dutch bank statement uses')
  assert.doesNotMatch(formatted, /[٠-٩]/, 'no Eastern Arabic numerals in an amount')
})

test('[TAAL] an unknown language is not silently a language', () => {
  for (const bad of ['de', '', null, undefined, 42, 'NL', 'ar-EG']) {
    assert.equal(isLocale(bad), false, `${JSON.stringify(bad)} is not one of ours`)
    assert.equal(resolveLocale(bad), DEFAULT_LOCALE, 'but it resolves to something usable')
  }
  assert.equal(isLocale('ar'), true)
  assert.equal(resolveLocale('ar'), 'ar')
})

test('[TAAL] Dutch has no URL prefix, and never gains one', () => {
  // /blog is indexed. A prefix for the canonical language is a redirect on every Dutch page.
  assert.equal(localePrefix('nl'), '')
  assert.equal(localePrefix('ar'), '/ar')
  assert.equal(localePrefix('tr'), '/tr')
  assert.equal(localePrefix('nonsense'), '', 'and the fallback inherits that')
})

// ── the catalogue ──────────────────────────────────────────────────────────────────────────────

test('[TAAL] every message exists in Dutch — the fallback has to be there to fall back to', () => {
  assert.ok(KEYS.length > 0)
  for (const key of KEYS) {
    const nl = (MESSAGES[key] as { nl: string }).nl
    assert.equal(typeof nl, 'string', `${key} has no Dutch`)
    assert.ok(nl.trim().length > 0, `${key} has empty Dutch`)
  }
})

test('[TAAL] a translation carries exactly the placeholders the Dutch does', () => {
  // This is the one mistake that costs real information. Drop {number} from a translated string
  // and the panel announcing a permanent invoice number stops naming it — in that language only,
  // on a screen nobody testing in Dutch will ever see.
  for (const key of KEYS) {
    const entry = MESSAGES[key] as Record<string, string>
    const want = placeholders(entry.nl)
    for (const l of LOCALES) {
      if (l === DEFAULT_LOCALE || !entry[l]) continue
      assert.deepEqual(
        placeholders(entry[l]), want,
        `${key} [${l}]: placeholders differ from the Dutch — ${JSON.stringify(entry[l])}`,
      )
    }
  }
})

test('[TAAL] no translation is present-but-empty — that is worse than absent', () => {
  // An absent key falls back to Dutch. An empty string is "translated", so it wins the lookup and
  // renders nothing. The translator guards it too; this asserts the data never asks it to.
  for (const key of KEYS) {
    const entry = MESSAGES[key] as Record<string, string>
    for (const l of LOCALES) {
      if (entry[l] === undefined) continue
      assert.ok(entry[l].trim().length > 0, `${key} [${l}] is an empty string`)
    }
  }
})

// ── the translator ─────────────────────────────────────────────────────────────────────────────

test('[TAAL] a missing translation falls back to Dutch, never to a key or a blank', () => {
  // The rule the whole design rests on. This is a bookkeeping app: a button reading
  // "sent.action.view", or an empty confirmation beside a permanent invoice number, is worse than
  // the same sentence in a language the owner reads less comfortably.
  const key: MessageKey = 'sent.action.view'
  assert.equal(translate('nl', key), 'Factuur bekijken')
  // Turkish is deliberately not written yet — the audience is real but this copy is legal in tone.
  assert.equal(translate('tr', key), 'Factuur bekijken', 'tr falls back, and it falls back to Dutch')
  assert.equal(translate('de', key), 'Factuur bekijken', 'so does a language we do not have')
  assert.ok(!translate('tr', key).includes('sent.'), 'a key may never reach the screen')
})

test('[TAAL] parameters are substituted, in every language', () => {
  assert.equal(
    translate('nl', 'sent.factuur.lead', { number: '2026-014', name: 'Jansen' }),
    'Factuur 2026-014 is onderweg naar Jansen.',
  )
  const ar = translate('ar', 'sent.factuur.lead', { number: '2026-014', name: 'Jansen' })
  assert.ok(ar.includes('2026-014') && ar.includes('Jansen'))
  assert.ok(!/[a-z]{4}/.test(ar.replace('Jansen', '')), 'the Arabic is Arabic, not the Dutch string')
})

test('[TAAL] a placeholder with no value stays visible instead of leaving a hole', () => {
  // "Factuur {number} ligt vast" is visibly broken and gets reported. "Factuur  ligt vast" reads
  // like a rendering hiccup and ships. On a screen about permanent numbers, loud is safe.
  const out = translate('nl', 'sent.factuur.lead', { name: 'Jansen' })
  assert.ok(out.includes('{number}'), out)
})

test('[TAAL] a bound translator is the same function, remembered', () => {
  const t = translator('ar')
  assert.equal(t('sent.row.amount'), translate('ar', 'sent.row.amount'))
  assert.equal(translator('rubbish')('sent.row.amount'), 'Bedrag')
})

// ── the first translated surface, end to end ───────────────────────────────────────────────────

test('[TAAL] the send confirmation reads Arabic, with the number and the amount intact', () => {
  const facts = {
    invoiceNumber: '2026-014',
    invoiceType: 'factuur',
    clientName: 'Stichting Contour de Twern',
    clientEmail: 'info@example.nl',
    totalInc: 394.99,
    replyTo: 'mo@boekbrug.nl',
  }
  const ar = invoiceSentNotice(facts, 'ar')!
  assert.equal(ar.title, 'تم إرسال الفاتورة')
  assert.ok(ar.lead.includes('2026-014'))
  assert.ok(ar.definitief.includes('2026-014'))
  // The facts survive translation untouched — they are data, not language.
  assert.ok(ar.rows.some(([, v]) => v === '2026-014'))
  assert.ok(ar.rows.some(([, v]) => v === 'info@example.nl'))
  assert.ok(ar.rows.some(([, v]) => v === '€ 394,99'), 'the amount is formatted once, in euros')
  assert.ok(ar.controle.some((r) => r.includes('mo@boekbrug.nl')))
  assert.equal(ar.controle.length, 4)
})

test('[TAAL] the check sentence names the words that are actually on the screen', () => {
  // Rule 2 of the catalogue, in its stronger form. This sentence used to spell "Facturen" and
  // "Verzonden" literally in every language, and that was RIGHT while those words were Dutch on
  // the screen: an owner told to look for a translated word would have found nothing.
  //
  // Both are translated now, so the literals became the wrong half of the rule. They are
  // parameters filled from nav.invoices and status.sent — the very keys the navigation bar and
  // the status chip render — so the sentence cannot name a label the interface does not have.
  // That is the property worth pinning, not the words themselves.
  for (const l of ['nl', 'ar', 'en'] as Locale[]) {
    const zin = invoiceSentNotice({ invoiceNumber: '2026-014', invoiceType: 'factuur' }, l)!.controle[0]
    assert.ok(zin.includes(translate(l, 'nav.invoices')), `${l}: must name the tab as the bar labels it — ${zin}`)
    assert.ok(zin.includes(translate(l, 'status.sent')), `${l}: must name the status as the chip labels it — ${zin}`)
    assert.ok(!zin.includes('{tab}') && !zin.includes('{status}'), `${l}: unfilled placeholder — ${zin}`)
  }
  // And in Dutch it still reads exactly as it did before any of this existed.
  assert.equal(
    invoiceSentNotice({ invoiceNumber: '2026-014', invoiceType: 'factuur' }, 'nl')!.controle[0],
    'De factuur staat nu bij Facturen met de status Verzonden.',
  )
})

test('[TAAL] Dutch is untouched by all of this', () => {
  // The regression that matters most right now: every Dutch user must see, to the character, what
  // they saw before the catalogue existed. No locale passed means Dutch.
  const facts = { invoiceNumber: '2026-014', invoiceType: 'factuur', clientName: 'Jansen', totalInc: 100 }
  const zonder = invoiceSentNotice(facts)!
  const metNl = invoiceSentNotice(facts, 'nl')!
  assert.deepEqual(zonder, metNl)
  assert.equal(zonder.title, 'Factuur verstuurd')
  assert.equal(zonder.lead, 'Factuur 2026-014 is onderweg naar Jansen.')
  assert.match(zonder.definitief, /^Nummer 2026-014 ligt vast\./)
})

test('[TAAL] a creditnota is not a factuur in any language', () => {
  // The noun is a KEY, not a parameter — see rule 1 in the catalogue header. Substituting it would
  // work in Dutch and break Arabic agreement and Turkish suffix harmony, and the failure would be
  // "your credit note says you billed them" at the moment the number becomes permanent.
  for (const l of ['nl', 'ar', 'en'] as Locale[]) {
    const c = invoiceSentNotice({ invoiceNumber: '2026-015', invoiceType: 'creditnota' }, l)!
    const f = invoiceSentNotice({ invoiceNumber: '2026-015', invoiceType: 'factuur' }, l)!
    assert.notEqual(c.title, f.title, `${l}: a credit note may not be announced as an invoice`)
    assert.notEqual(c.definitief, f.definitief, `${l}`)
    assert.notEqual(c.rows[0][0], f.rows[0][0], `${l}: the number label differs too`)
  }
})
