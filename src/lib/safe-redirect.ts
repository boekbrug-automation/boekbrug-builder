// src/lib/safe-redirect.ts
// [SEC-REDIRECT] Eén plek die beslist of een ?redirect= / ?next= veilig is — puur, geen I/O.
//
// ── WAAROM DIT BESTAAT ──
// Drie plekken in deze app nemen een bestemming aan van de querystring en navigeren erheen na
// een geslaagde inlog of registratie. Precies ÉÉN daarvan controleerde die waarde: de
// OAuth-callback, met een reguliere expressie en een [SEC]-toelichting erboven. /login en
// /register deden `router.push(decodeURIComponent(param))` zonder enige controle.
//
// Dat is niet alleen een open redirect ("meld je aan" → een namaakpagina op een ander domein,
// mét de geloofwaardigheid van onze eigen inlog ervoor). Het is ook een XSS-gat, en dat staat
// met zoveel woorden in de documentatie van de router die wij gebruiken:
//
//   "You must not send untrusted or unsanitized URLs to router.push or router.replace, as this
//    can open your site to cross-site scripting (XSS) vulnerabilities. For example,
//    `javascript:` URLs sent to router.push or router.replace will be executed in the context
//    of your page."
//   — node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md
//
// Dus /register?redirect=javascript:… voerde na registratie vreemde code uit op onze eigen
// origin, met de sessie die net was aangemaakt. Een controle die op één van de drie plekken
// staat, is geen controle — het is een toevalligheid. Vandaar dit bestand: één regel, één
// waarheid, en een test die de bekende omzeilingen vastlegt.
//
// ── WAT ER DOORHEEN KOMT ──
// Alleen een pad op onze eigen origin: het begint met precies één "/". Al het andere valt terug
// op de meegegeven bestemming. De faalrichting is bewust die kant op: iemand die op de
// verkeerde eigen pagina landt kan doorklikken, iemand die op een vreemd domein landt niet.

/** Tekens die een browser uit een URL wegpoetst — en waarmee "/\n/evil.nl" alsnog "//evil.nl" wordt. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/;

/**
 * Is dit een bestemming waar wij iemand heen mogen sturen?
 *
 * Geaccepteerd: een pad op dezelfde origin — één "/" aan het begin, daarna geen tweede "/" en
 * geen "\". Dat sluit in één regel drie families uit:
 *
 *   · een absolute URL      — "https://evil.nl" begint niet met "/"
 *   · een schema zonder //  — "javascript:alert(1)", "data:text/html,…" idem
 *   · een protocol-relatief pad — "//evil.nl" en zijn tegenhanger "/\evil.nl", die elke
 *     browser leest als "kies mijn schema en ga naar evil.nl"
 *
 * Stuurtekens worden apart geweigerd omdat browsers ze uit een URL verwijderen: "/\t/evil.nl"
 * en "/\n/evil.nl" zouden na dat opschonen alsnog met "//" beginnen.
 */
export function isSafeRedirect(raw: string | null | undefined): raw is string {
  if (typeof raw !== "string" || raw === "") return false;
  if (CONTROL_CHARS.test(raw)) return false;
  return /^\/(?![/\\])/.test(raw);
}

/**
 * De bestemming, of de terugval als die niet vertrouwd is.
 *
 * `fallback` is met opzet verplicht: elke aanroeper heeft een andere juiste thuisbasis
 * (/dashboard na inloggen, de kluis of de wizard na registratie), en een stille standaardwaarde
 * zou iemand ongemerkt op de verkeerde pagina zetten.
 *
 * ⚠️ Geef door wat `searchParams.get()` / `URLSearchParams.get()` teruggaf en niets anders. Die
 * hebben de waarde AL één keer gedecodeerd. Er stond hier eerder een tweede
 * `decodeURIComponent()` overheen, en die had twee problemen: hij liep stuk op een letterlijk
 * procentteken (URIError → het scherm bleef op "Bezig..." staan terwijl het account gewoon was
 * aangemaakt), en hij kon een geëncodeerde "%2F%2Fevil.nl" alsnog tot "//evil.nl" uitpakken —
 * ná de controle die er dan overheen was gegaan.
 */
export function safeRedirect(raw: string | null | undefined, fallback: string): string {
  return isSafeRedirect(raw) ? raw : fallback;
}

/**
 * [BESTEMMING] A path with the visitor's destination attached — or the bare path when there is
 * nothing worth carrying.
 *
 * The password-reset chain lost the destination at its first link: /login carried ?redirect= and
 * the "Wachtwoord vergeten?" anchor was a bare href, so an invited accountant who reset a password
 * on the way came back to a bare /login and landed on a dashboard with the invitation nowhere in
 * sight. Every link in that chain now goes through this one function.
 *
 * [SEC-REDIRECT] The value is checked HERE, before it travels: a link may only ever carry what the
 * receiving screen would accept, and an unsafe value is dropped rather than passed along for the
 * receiver to throw away. Encoded once, with encodeURIComponent, so a destination that itself
 * carries a query string ("/invite/accept?token=…") survives the trip intact — and so a nested
 * carrier ("/verificatie?redirect=/wachtwoord-herstellen?redirect=…") unpacks one layer per hop.
 */
export function withRedirect(path: string, raw: string | null | undefined): string {
  if (!isSafeRedirect(raw)) return path;
  return `${path}${path.includes("?") ? "&" : "?"}redirect=${encodeURIComponent(raw)}`;
}
