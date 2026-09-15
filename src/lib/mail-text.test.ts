// [MAIL-TEKST] Pure node test — run: npx tsx --test src/lib/mail-text.test.ts
//
// The text part exists for two readers: the spam filter that scores HTML-only mail, and the
// human whose client shows text — a watch, a screen reader, the preview line. What is pinned
// here is that neither reader loses a FACT the HTML carries: an amount, a number, a URL, a name.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { htmlToMailText } from './mail-text'

test('[MAIL-TEKST] the real invoice template survives with every fact intact', () => {
  // The shape sendInvoiceToClient actually builds — the mail that asks a stranger for money.
  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #202124;">Nieuwe factuur ontvangen</h2>
      <p style="color: #555;">Beste ${'Jansen &amp; Zn'},</p>
      <p style="color: #555;">Je hebt een factuur ontvangen van <strong>Kiwi Food Market</strong>.</p>
      <div style="background:#f8f9fa; border-radius:12px; padding:16px; margin:20px 0;">
        <p style="margin:0; color:#202124;"><strong>Factuurnummer:</strong> 2026-014</p>
        <p style="margin:0; color:#202124;"><strong>Bedrag:</strong> &euro; 394,99</p>
        <p style="margin:0; color:#202124;"><strong>Vervaldatum:</strong> 07-09-2026</p>
      </div>
      <p style="color: #555;">Vragen over deze factuur? Antwoord op deze mail of neem contact op via <a href="mailto:mo@kiwi.nl" style="color:#1a73e8;">mo@kiwi.nl</a>.</p>
      <p style="color: #5f6368; font-size: 12px;">De factuur is bijgevoegd als PDF.</p>
    </div>`
  const text = htmlToMailText(html)

  for (const fact of ['2026-014', '€ 394,99', '07-09-2026', 'Kiwi Food Market', 'mo@kiwi.nl']) {
    assert.ok(text.includes(fact), `the text part lost "${fact}":\n${text}`)
  }
  assert.ok(text.includes('Jansen & Zn'), 'the escaped ampersand is decoded back for a human')
  assert.ok(!text.includes('<'), 'no tag survives')
  assert.ok(!text.includes('font-family'), 'no style residue survives')
})

test('[MAIL-TEKST] a link keeps its URL — text-mode readers cannot click nothing', () => {
  const text = htmlToMailText('<p>Klik <a href="https://boekbrug.nl/accept?x=1">Uitnodiging accepteren</a> om verder te gaan.</p>')
  assert.ok(text.includes('Uitnodiging accepteren (https://boekbrug.nl/accept?x=1)'), text)
  // A link whose text IS the url prints once, not twice.
  const twice = htmlToMailText('<a href="https://boekbrug.nl">https://boekbrug.nl</a>')
  assert.equal(twice, 'https://boekbrug.nl')
})

test('[MAIL-TEKST] structure becomes readable lines, not one long line and not a void', () => {
  const text = htmlToMailText('<h2>Kop</h2><p>Eerste zin.</p><p>Tweede zin.</p><br>Derde.')
  assert.match(text, /Kop\n+Eerste zin\.\n+Tweede zin\.\n/, text)
  assert.ok(!text.includes('\n\n\n'), 'runs of blank lines are collapsed')
})

test('[MAIL-TEKST] style and script contents vanish with their tags', () => {
  const text = htmlToMailText('<style>.a{color:red}</style><p>Echt</p><script>alert(1)</script>')
  assert.equal(text, 'Echt')
})

test('[MAIL-TEKST] entities a template actually produces are decoded', () => {
  assert.equal(htmlToMailText('<p>&euro;&nbsp;100 &amp; meer&hellip;</p>'), '€ 100 & meer…')
  assert.equal(htmlToMailText('<p>&#8364; 5 en &#x20AC; 6</p>'), '€ 5 en € 6')
})

test('[MAIL-TEKST] it never throws and never returns empty for visible words', () => {
  assert.equal(htmlToMailText(''), '')
  assert.equal(htmlToMailText(null as unknown as string), '')
  assert.ok(htmlToMailText('<div><p>woord</p></div>').length > 0)
})

test("an address linked as itself is not printed twice", () => {
  // The sign-off links `boekbrug.nl` to https://boekbrug.nl. Compared literally the two differ, so
  // every mail used to close with the same address twice in its last line.
  const voet = htmlToMailText('<a href="https://boekbrug.nl">boekbrug.nl</a>');
  assert.equal(voet, "boekbrug.nl");
  assert.equal(htmlToMailText('<a href="https://boekbrug.nl/">boekbrug.nl</a>'), "boekbrug.nl");
});

test("…but a link whose text says something keeps its url", () => {
  // The rule that earns the noise: a text-mode reader told to click "Bekijk de factuur" with the
  // url stripped has been told to click nothing.
  const knop = htmlToMailText('<a href="https://boekbrug.nl/factuur/9">Bekijk de factuur</a>');
  assert.match(knop, /Bekijk de factuur \(https:\/\/boekbrug\.nl\/factuur\/9\)/);
});
