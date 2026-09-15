// src/lib/mail-merk.ts
// [MERK-KOP] The BoekBrug wordmark at the top of a mail, and the link home under it.
//
// Not one mail this app sends carries a brand header. Every one opens straight into a sentence,
// which is why the morning digest reads like a machine note rather than like post from a product
// the owner pays for — and why, in a mailbox of forty unread, it is not recognisable at a glance.
//
// ── WHY A WORDMARK AND NOT THE LOGO IMAGE ──
//
// This is the one decision in this file worth arguing, because the obvious answer is wrong.
//
// Gmail, Outlook and Apple Mail block remote images by default, and Apple's Mail Privacy
// Protection proxies or suppresses them even when they load. An <img> logo therefore reaches most
// readers as a grey box, an alt-text stub, or nothing at all — so the mail that was supposed to be
// instantly recognisable opens with a hole where its identity should be. That is worse than the
// plain sentence it replaced.
//
// A wordmark set in TEXT renders in every client, at any width, with images off, in dark mode, and
// it costs no request. It is also the only version that cannot be mistaken for a tracking pixel,
// which matters for a mail whose deliverability was fought for once already ([BEZORGING]).
//
// ── AND THE BOUNDARY THAT MUST NOT MOVE ──
//
// This header belongs on a mail BoekBrug sends to ITS OWN user — the owner, their accountant, an
// invitee. It must NEVER appear on the invoice mail an owner sends their customer. That message is
// the owner's, to their customer, about their money; putting our name at the top of it would brand
// someone else's business correspondence with our product. [EIGEN-MARKER] drew that line on the
// PDF for the same reason, and a gate holds it here.
//
// Pure. Run: npx tsx --test src/lib/mail-merk.test.ts

import { escapeHtml } from "./escape-html";

/**
 * The brand blue. Already written by hand in a dozen mails and screens, in two different casings;
 * a second definition of a colour is how two mails come to be almost the same blue.
 */
export const MERK_BLAUW = "#1A73E8";

/**
 * The public site, and what the sign-off points at.
 *
 * Not `/dashboard`, which is where the header goes: the footer also ends the invoice mail, and the
 * customer reading that has no account. A link into a dashboard they cannot open is worse than no
 * link — it is the product looking like it was not written for them.
 */
export const MERK_URL = "https://boekbrug.nl";

/**
 * The header: the wordmark as a link home, and the blue rule under it.
 *
 * `baseUrl` is the absolute origin, because a mail has no origin of its own — a root-relative href
 * in an inbox resolves against the mail client, which is nowhere.
 */
export function merkKop(baseUrl: string = MERK_URL): string {
  const home = `${escapeHtml(baseUrl)}/dashboard`;
  return `
      <a href="${home}" style="display: inline-block; text-decoration: none; color: ${MERK_BLAUW}; font-size: 20px; font-weight: 700; letter-spacing: -0.2px;">BoekBrug</a>
      <div style="height: 3px; background: ${MERK_BLAUW}; border-radius: 2px; margin: 6px 0 18px; width: 44px;"></div>`;
}

/**
 * [MERK-VOET] The sign-off under every mail this product sends, in the shape the invoice PDF
 * already uses: the name at the weight a name needs to be recognised, the tagline and the address
 * under it, both linked.
 *
 * ── WHY THIS IS ALLOWED HERE AND THE HEADER IS NOT ──
 *
 * The boundary above is about the WORDMARK AT THE TOP: our name opening a message an owner sends
 * their customer would read as if we had sent it. The foot of the message is the opposite
 * position — it is where the PDF has carried the same credit line to the same customer since
 * [VOETTEKST-MERK], and where the thirteen mails already had it, hand-written in four different
 * greys and three different margins.
 *
 * So the same discipline the PDF wrote down applies word for word: this stays a CREDIT LINE and
 * never becomes a letterhead. 15px is under the mail's own <h2> and nowhere near it, it sits below
 * everything the reader came for, and the sender's own name keeps the subject line and the From.
 * An invoice that shouts someone else's brand reads as if that someone sent it — which would cost
 * the owner more than the mention is worth.
 *
 * The line above the brand is the CALLER'S, and it carries two different things: the opt-out
 * sentence on a mail that has one, and "who this came through" on the message an accountant sends
 * their client. Only the caller knows which — a footer that guesses the opt-out sends the owner to
 * a setting that does not exist for this mail. Most mails need neither, being answers to something
 * the reader just did, so it is optional rather than an empty string every call has to pass.
 *
 * The visible address is DERIVED from the link, never written beside it. A preview deploy passing
 * its own baseUrl would otherwise print "boekbrug.nl" over an href pointing somewhere else, which
 * is the one kind of wrong a footer must not be.
 */
export function merkVoet(baseUrl: string = MERK_URL, eigenRegel?: string): string {
  const home = escapeHtml(baseUrl);
  const zichtbaar = home.replace(/^https?:\/\//, "");
  const eigen = eigenRegel ? `${escapeHtml(eigenRegel)}<br /><br />` : "";
  return `
      <p style="color: #5f6368; font-size: 12px; margin-top: 32px; line-height: 1.6;">
        ${eigen}<a href="${home}" style="color: ${MERK_BLAUW}; font-size: 15px; font-weight: 700; text-decoration: none;">BoekBrug</a><br />
        De brug tussen jou en je boekhouder · <a href="${home}" style="color: ${MERK_BLAUW}; text-decoration: none;">${zichtbaar}</a>
      </p>`;
}

/**
 * The same sign-off for a hand-written text/plain part.
 *
 * Most mails derive their text half from the html at the send chokepoint ([MAIL-TEKST]) and need
 * nothing here. The invoice mail writes its own, because the facts a customer needs must survive
 * in a fixed order — so it needs the sign-off as text, from the same place, or the two halves
 * drift the moment one is edited.
 */
export function merkVoetTekst(): string {
  return `BoekBrug — De brug tussen jou en je boekhouder\n${MERK_URL.replace(/^https?:\/\//, "")}`;
}
