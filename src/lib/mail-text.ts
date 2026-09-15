// src/lib/mail-text.ts
// [MAIL-TEKST] The plain-text half of every e-mail this product sends. Pure, no I/O.
// Run: npx tsx --test src/lib/mail-text.test.ts
//
// WHY A TEXT PART AT ALL
// Every one of the fifteen senders in email.ts sent HTML with NO text/plain alternative. That is
// not a cosmetic gap: an HTML-only message is one of the oldest spam heuristics there is —
// legitimate mail clients always send both, spam kits often do not — so SpamAssassin scores it
// (MIME_HTML_ONLY) and Gmail weighs it against a young domain with no sending history. For the
// mail that asks a stranger to pay money, on a domain whose reputation is still being built,
// giving filters this free negative signal is the kind of thing that decides inbox-or-spam.
//
// The text part also IS the message for real readers: screen readers, watch previews, and the
// preview line under the subject in most clients are built from it when present.
//
// WHY DERIVED AND NOT HAND-WRITTEN
// Fifteen senders means fifteen chances for the two versions to drift — the [CENT] lesson on
// prose. Deriving the text from the SAME html string the send call uses makes drift structurally
// impossible: change the sentence once and both parts change. The derivation is lossy on purpose
// (layout dies, words survive), which is exactly what a text part is.
//
// WHAT IT HANDLES, BECAUSE OUR TEMPLATES CONTAIN IT
//   · block elements end a line; <br> breaks one;
//   · an <a href> keeps its URL — "Bekijk de factuur" with the link stripped would tell a
//     text-mode reader to click nothing. Anchor text first, URL in brackets after it;
//   · &amp; &euro; &nbsp; and the numeric forms are decoded — the templates escape user names
//     (escapeHtml), and "Jansen &amp; Zn" may not reach a human that way;
//   · <style> blocks vanish WITH their contents, not just their tags.

const BLOCK_END = /<\/(?:p|div|h[1-6]|li|tr|table|ul|ol|blockquote)>/gi;

/** An address as a person writes it: no scheme, no trailing slash. Used only to decide whether an
 *  anchor's text and its href are the same address said two ways. */
const naaktAdres = (s: string): string => s.replace(/^https?:\/\//i, "").replace(/\/+$/, "").toLowerCase();

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: " ", euro: "€", eacute: "é", euml: "ë", iuml: "ï", ndash: "–", mdash: "—",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", hellip: "…",
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * The text/plain version of an HTML mail body.
 *
 * Never throws and never returns an empty string for a non-empty input with visible words —
 * a present-but-empty text part looks MORE like spam than none at all.
 */
export function htmlToMailText(html: string): string {
  let s = String(html ?? "");

  // Containers whose CONTENT is not prose.
  s = s.replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");

  // Links: keep both halves. "Anchor text (https://…)" — but only when the URL adds information;
  // a link whose text IS the url would otherwise print twice.
  //
  // "Is the url" includes the form a person actually writes one in. The sign-off under every mail
  // links the address as `boekbrug.nl`, and comparing the two strings literally made that close
  // every message with "boekbrug.nl (https://boekbrug.nl)" — the same address twice, in the last
  // line the reader sees. The scheme and a trailing slash are the two things a visible address
  // leaves off, so they are what the comparison ignores; anything else in the text is information
  // ("Bekijk de factuur" keeps its url, which is the whole point of the rule).
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, "").trim();
    if (!href || href.startsWith("mailto:")) return text || href.replace(/^mailto:/, "");
    if (!text) return href;
    if (text === href || naaktAdres(text) === naaktAdres(href)) return text;
    return `${text} (${href})`;
  });

  // Structure to whitespace.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(BLOCK_END, "\n\n");
  s = s.replace(/<li\b[^>]*>/gi, "• ");
  s = s.replace(/<[^>]+>/g, "");

  s = decodeEntities(s);

  // Collapse the layout residue: spaces around lines, runs of blank lines.
  return s
    .split("\n").map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
