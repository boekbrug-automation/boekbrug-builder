// src/lib/mail-merk.test.ts — run: npx tsx --test src/lib/mail-merk.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { merkKop, merkVoet, merkVoetTekst, MERK_BLAUW, MERK_URL } from "./mail-merk";

test("the wordmark is TEXT, never an image", () => {
  // Gmail, Outlook and Apple Mail block remote images by default. An <img> logo reaches most
  // readers as a grey box — a hole exactly where the mail's identity should be.
  const kop = merkKop("https://boekbrug.nl");
  assert.doesNotMatch(kop, /<img/i, "an image logo is invisible to most readers");
  assert.match(kop, /BoekBrug<\/a>/);
});

test("the wordmark is the link, and it opens the app", () => {
  const kop = merkKop("https://boekbrug.nl");
  assert.match(kop, /href="https:\/\/boekbrug\.nl\/dashboard"/);
});

test("the link is absolute — a mail has no origin of its own", () => {
  const kop = merkKop("https://boekbrug.nl");
  assert.doesNotMatch(kop, /href="\/[^/]/, "a root-relative href resolves against the mail client, which is nowhere");
});

test("the blue rule is there, in the one brand blue", () => {
  const kop = merkKop("https://boekbrug.nl");
  assert.ok(kop.includes(MERK_BLAUW), "the rule must use the shared colour, not a second almost-blue");
  assert.match(kop, /height: 3px; background: #1A73E8/);
});

test("a hostile base url cannot break out of the attribute", () => {
  const kop = merkKop('https://x.nl/" onmouseover="alert(1)');
  // The payload's TEXT survives — it is part of the url now — and that is fine. What must not
  // survive is a real quote closing the href early, which is the only thing that would turn it
  // into an attribute. Asserting the text is absent would be asserting the wrong thing, and would
  // pass on an escaper that stripped characters instead of encoding them.
  assert.doesNotMatch(kop, /onmouseover="/, "an unescaped quote would end the href and start an attribute");
  assert.match(kop, /onmouseover=&quot;/, "…so it stays inside the href, encoded");
  assert.equal((kop.match(/href="/g) ?? []).length, 1, "exactly one href, and it is still one attribute");
});

test("the wordmark needs no base url of its own", () => {
  // Eleven senders have no baseUrl in scope — they are answers to something the reader did, not
  // cron output carrying a deploy origin. Without a default they would each hard-code the address,
  // which is how a product comes to have two.
  assert.equal(merkKop(), merkKop(MERK_URL));
  assert.match(merkKop(), /href="https:\/\/boekbrug\.nl\/dashboard"/);
});

test("the footer says what the product is, and carries the caller's own line", () => {
  const voet = merkVoet(MERK_URL, "Je krijgt dit alleen op dagen dat er iets gebeurde.");
  assert.match(voet, /dagen dat er iets gebeurde/);
  assert.match(voet, /De brug tussen jou en je boekhouder/);
});

test("the caller's line is optional — most mails answer something the reader just did", () => {
  const voet = merkVoet();
  assert.match(voet, /De brug tussen jou en je boekhouder/, "the sign-off stands on its own");
  assert.doesNotMatch(voet, /<br \/><br \/>/, "no empty slot left where a caller line would have gone");
});

test("the caller's line is escaped, whichever of its two jobs it is doing", () => {
  // Two callers, two meanings: an opt-out sentence, and "who this came through". Both are strings
  // from outside this module, and one of them is a person's name.
  assert.doesNotMatch(merkVoet(MERK_URL, "<script>alert(1)</script>"), /<script>/);
  assert.doesNotMatch(merkVoet(MERK_URL, 'Jan "</p><script>x" · via BoekBrug'), /<script>/);
});

test("the sign-off points at the site, not at a dashboard the reader cannot open", () => {
  // The same footer ends the invoice mail, and the customer reading that has no account.
  const voet = merkVoet();
  assert.match(voet, /href="https:\/\/boekbrug\.nl"/);
  assert.doesNotMatch(voet, /\/dashboard/, "the header links home; the footer links to the site");
});

test("the visible address is derived from the link, never written beside it", () => {
  // A preview deploy passing its own baseUrl must not print boekbrug.nl over a different href.
  const voet = merkVoet("https://preview.example.nl");
  assert.match(voet, /href="https:\/\/preview\.example\.nl"/);
  assert.match(voet, />preview\.example\.nl</, "the text follows the href");
  assert.doesNotMatch(voet, />boekbrug\.nl</, "…and never contradicts it");
});

test("the name is set like a name, and stays a credit line", () => {
  // [VOETTEKST-MERK] on the PDF: recognisable, and never a letterhead on someone else's invoice.
  const voet = merkVoet();
  assert.match(voet, /font-size: 15px; font-weight: 700/, "a name that is meant to be recognised is set like one");
  assert.ok(voet.includes(MERK_BLAUW), "one brand blue, not a second almost-blue");
  assert.doesNotMatch(voet, /font-size: (1[89]|[2-9]\d)px/, "bigger than this is a letterhead");
});

test("the text twin says the same thing, from the same place", () => {
  const tekst = merkVoetTekst();
  assert.match(tekst, /BoekBrug — De brug tussen jou en je boekhouder/);
  assert.match(tekst, /boekbrug\.nl/);
  assert.doesNotMatch(tekst, /<|>/, "a text part with markup in it is a bug in both halves");
});
