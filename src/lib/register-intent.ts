// src/lib/register-intent.ts
// [OAUTH-ROL] Wat de bezoeker bij de voordeur koos, onderweg door OAuth — puur, geen I/O.
//
// ── WAAROM DIT BESTAAT ──
// Stap 1 van /register vraagt één ding: ben je ZZP'er of boekhouder. Daarna kan de bezoeker
// verder met Google, en op dat moment ging het antwoord verloren.
//
// Niet bij ongeluk onopgemerkt: er stond een comment boven de knop dat het WEL werd
// meegegeven ("Role is stored in step 1 — passed as state through OAuth so callback can save
// it"), en een tweede comment dat een eerdere poging beschreef met een `state`-object dat
// nergens aan signInWithOAuth werd meegegeven. Dat tweede comment concludeerde dat `next` "de
// weg is die er al lag" — maar `next` draagt alleen de bestemming, nooit de rol. De callback
// schreef intussen onvoorwaardelijk role: 'zzper'.
//
// Gevolg: elke boekhouder die zich via Google aanmeldde kwam binnen als ZZP'er. Het herstelt
// zichzelf (de wizard vraagt het opnieuw, omdat een kaal profiel op stap 1 staat), dus het is
// nooit als storing gemeld — maar de eerste vraag die wij stellen werd wél stil weggegooid.
//
// ── WAAROM DIT GEEN HANDTEKENING NODIG HEEFT ──
// Een rol is in deze app een ZELFVERKLARING en niets meer. Dat is geen slordigheid maar een
// vastgelegde keuze: ai_spend_guard.sql legt uit dat niemand kan afdwingen dat de verklaring
// klopt — wie 'Boekhouder' aanklikt in het formulier krijgt hem net zo goed — en dat het
// toegangsbesluit daarom op BEWIJS rust: minstens één accountant_clients-koppeling met
// toestemming, waarbij zelf-koppelen al geblokkeerd is.
//
// Deze waarde ondertekenen of versleutelen zou dus iets beschermen wat niet beschermd is, en
// zou vooral de indruk wekken dat de rol een gecontroleerd feit is. Wat wél moet gebeuren is
// het enige wat hier gebeurt: de waarde toetsen aan de twee bekende rollen voordat zij ergens
// wordt opgeslagen. Precies dezelfde toets die handle_new_user() in SQL al doet.

import type { Role } from "./navigation";

export type { Role };

/** De querystring waarmee /register de rolkeuze meegeeft aan zijn eigen OAuth-callback. */
export const ROLE_PARAM = "rol";

/**
 * Lees een rol uit onbetrouwbare invoer (querystring, gebruikersmetadata, databasekolom).
 *
 * Geeft `null` terug bij alles wat niet exact 'zzper' of 'accountant' is — inclusief afwezig.
 * Dat is met opzet géén stille terugval op 'zzper' zoals in de SQL-trigger: daar MOET een
 * waarde staan omdat de rij op dat moment wordt aangemaakt, terwijl een lezer van deze functie
 * juist moet kunnen zien of er iets gekozen is. "Niets gekozen" en "ZZP'er gekozen" zijn twee
 * verschillende dingen zodra je een bestaand profiel voor je hebt: bij het eerste hoor je niets
 * aan te raken.
 *
 * Let op 'client': dat is wel een geldige waarde in de CHECK op profiles.role, maar het is geen
 * rol die iemand zichzelf bij registratie geeft. Hij hoort hier dus niet doorheen te komen.
 */
export function parseRole(raw: string | null | undefined): Role | null {
  return raw === "zzper" || raw === "accountant" ? raw : null;
}

// ── [EERSTE-DEUR] "This callback is the tail of a registration" ──────────────────────────────────
//
// The third thing /register has to tell its own callback, beside the role and the purpose, and it
// lives here for the same reason they do: it travels as a querystring, so it is untrusted input
// that must be narrowed before anything reads it.
//
// WHY A FLAG AND NOT AN INFERENCE. The callback cannot work out on its own that a request is a
// fresh registration rather than an ordinary sign-in. Everything it could infer from is wrong:
// `role === 'zzper'` is also the trigger's default, `onboarding_step` is a resume position and not
// a provenance, and a bare profile is exactly what a half-finished wizard looks like too. Guessing
// there is how a returning owner gets his onboarding silently completed — or a new one gets sent
// back into a wizard. So /register says so, explicitly, on the URL it builds itself.
//
// WHY IT IS SAFE THAT ANYONE CAN SET IT. This is UX intent, never authorisation. It decides which
// SCREEN a person lands on and whether their own fresh profile is marked done — nothing that
// another account can see, reach or lose. The two real guards sit elsewhere and are untouched: the
// session comes from exchangeCodeForSession, and every write is scoped to `.eq('id', user.id)`.
// Setting this by hand on your own callback buys you what clicking through the wizard would have
// given you anyway. It also cannot defeat the [PROFILE-READ] refusal: that branch returns before
// this value is ever consulted.
//
// /login deliberately does NOT set it — see the comment at its signInWithOAuth call. An existing
// user signing in is not registering, and that difference is the whole point of this parameter.

/** The querystring with which /register marks its own callback as the end of a registration. */
export const REGISTER_PARAM = "registratie";

/** The one value that counts. Anything else — absent, empty, "0", "true" — is not a registration. */
export const REGISTER_FLAG = "1";

/**
 * Did this callback come from the registration door?
 *
 * Exact match, and deliberately so: the fail direction is "no, this is an ordinary sign-in", which
 * costs at most one wizard too many. The opposite mistake would complete an onboarding nobody
 * finished. Same shape as parseRole above — narrow untrusted input before anything acts on it.
 */
export function parseRegisterIntent(raw: string | null | undefined): boolean {
  return raw === REGISTER_FLAG;
}
