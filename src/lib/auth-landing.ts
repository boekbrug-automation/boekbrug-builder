// src/lib/auth-landing.ts
// [KLUIS][OAUTH-ROL] Wat er na de OAuth-callback moet gebeuren — puur, geen I/O.
//
// ── WAAROM DIT EEN APART BESTAND IS ──
// De callback nam vier beslissingen door elkaar: bestaat er al een profiel, welke rol schrijven
// we, is dit een archiefaccount, en waar gaat de gebruiker heen. Ze stonden verweven met de
// databaseaanroepen, en daardoor kon niemand ze lezen zonder de aanroepen mee te lezen — laat
// staan testen.
//
// Dat is niet theoretisch gebleven. Precies hier zat de fout die het archiefpad brak: `next`
// wees al naar de kluis, maar de regel "stuur elke nieuwe gebruiker naar /onboarding" stond
// ervóór en won altijd. Een regel te vroeg, en de hele voordeur van /bewaarplicht kwam nergens
// uit. Zoiets is onzichtbaar in code die je alleen kunt uitproberen door je echt te
// registreren; in een pure functie is het een test van drie regels.
//
// Deze functie beslist dus, en de route voert alleen nog uit.
//
// ── [PROFILE-READ] WHY THE SECOND PARAMETER IS A CLASSIFIED READ AND NOT A ROW ──
// It used to be `CallbackProfile | null`, which reads as an invitation to hand over whatever
// `data` came back — and that is precisely how the callback was written. supabase-js never
// throws, so a read that FAILED arrives as the same null as a row that is MISSING, and this
// function acts on "missing" by ordering a profile to be created. One refused or timed-out read
// therefore wrote role / onboarding_step / onboarding_done / full_name over a profile that
// already existed: a finished accountant signing in with Google carries no ?rol=, so the plan
// fell back to 'zzper' — demoted, onboarding_done back to false, and into the wizard.
//
// The middleware, /dashboard and /onboarding were all converted to classifyProfileRead for that
// exact bug (see the header of profile-read.ts, which counts three readers). This was the fourth
// and it was missed, because nothing in the signature asked the question. Taking the three
// answers AS the parameter type makes forgetting one unrepresentable — the same shape, for the
// same reason, as onboardingGate({ read, pathname }) next door.

import { isSafeRedirect, safeRedirect } from "./safe-redirect";
import { parseRole, type Role } from "./register-intent";
import { PURPOSE_PARAM, landingPath, parsePurpose } from "./account-purpose";
import type { ProfileRead } from "./profile-read";
// [PROFILE-READ] The one path that may continue on an unreadable profile, imported rather than
// spelled again: /dashboard/page.tsx classifies the same read itself and throws to its error
// boundary ("Er ging iets mis", with a retry), which is the honest screen. Two copies of that
// constant would be two places to change when the honest screen moves.
import { HOME_PATH } from "./onboarding-gate";

/** Wat de callback aan de querystring meekrijgt. Onbetrouwbare invoer, ruw doorgegeven. */
export interface CallbackIntent {
  /** ?next= — de gewenste bestemming. */
  next: string | null;
  /** ?rol= — de keuze uit stap 1 van /register. */
  role: string | null;
  /** ?doel= — waarvoor deze bezoeker binnenkomt. */
  purpose: string | null;
}

/** De velden van het profiel waar deze beslissing op rust. */
export interface CallbackProfile {
  onboarding_done: boolean | null;
  onboarding_step: number | null;
  role: string | null;
}

export interface CallbackPlan {
  /** Waar de gebruiker heen gaat. Altijd een pad op onze eigen origin. */
  destination: string;
  /** Aan te maken profiel, of null als er al een rij is. */
  profileToCreate: { role: Role; onboarding_done: boolean; onboarding_step: number } | null;
  /** Rol die op een BESTAAND profiel geschreven moet worden, of null om het niet aan te raken. */
  roleUpdate: Role | null;
  /** Moet dit profiel als archiefaccount worden vastgelegd? */
  markArchief: boolean;
  /**
   * May the route backfill full_name from the identity metadata onto an existing row?
   *
   * [PROFILE-READ] This write lived in the route as a bare `else if (metaName)`, outside the
   * plan — so a plan that ordered nothing still left one write standing. It is a decision about
   * profile state like the other three (only a row that EXISTS can be backfilled), so it belongs
   * here: every write the route performs is now plan-driven, and "this plan orders no write" is
   * one assertion instead of four scattered ones.
   *
   * The route still guards it with `.is('full_name', null)` — a name the owner has since edited
   * is never overwritten, and that guard is a property of the write, not of this decision.
   */
  backfillName: boolean;
}

/**
 * Mag een meegereisde keuze (rol, doel) nog op dit profiel geschreven worden?
 *
 * Alleen als het de wizard nog niet gepasseerd is: stap 1 of lager én onboarding niet afgerond.
 * Dat is met opzet eng. Wie de wizard heeft doorlopen of al verder stond, heeft die keuzes al
 * gemaakt in de app zelf, en een parameter in een URL hoort daar niet overheen te gaan.
 *
 * Bij Google is dit het NORMALE geval, niet de uitzondering: on_auth_user_created vuurt tijdens
 * exchangeCodeForSession, dus tegen de tijd dat de callback kijkt bestaat de rij al — kaal,
 * want een OAuth-aanmelding draagt geen signUp-metadata.
 */
function isOnbeschreven(profile: CallbackProfile): boolean {
  return !profile.onboarding_done && (profile.onboarding_step ?? 1) <= 1;
}

export function planAfterOAuth(
  intent: CallbackIntent,
  read: ProfileRead<CallbackProfile>,
): CallbackPlan {
  const chosenRole = parseRole(intent.role);
  const wantsArchief = parsePurpose(intent.purpose) === "archief";

  // De bestemming, met de terugval van deze route. [SEC-REDIRECT] `isSafeRedirect` weigert alles
  // wat niet een pad op onze eigen origin is; het onderscheid "is er een bestemming" is nodig
  // omdat een meegegeven bestemming (een uitnodiging, een betaalpagina) vóór de standaardlanding
  // van het archiefpad gaat.
  const hasNext = isSafeRedirect(intent.next);
  const next = safeRedirect(intent.next, HOME_PATH);
  const archiefLanding = `${landingPath("archief")}?${PURPOSE_PARAM}=archief`;

  // [UITNODIGING] Een uitnodigingslink wint van de wizard — de tweede keer dat deze les valt.
  //
  // De kop van dit bestand beschrijft hoe het archiefpad brak: `next` wees al goed, maar de regel
  // "elke nieuwe gebruiker naar /onboarding" stond ervóór en won altijd. Precies dezelfde fout
  // zat op het uitnodigingspad, en daar was hij duurder. De genodigde klant klikt de mail van
  // zijn BOEKHOUDER, registreert, bevestigt zijn e-mail — en de callback gooide het token weg en
  // zette hem in een wizard over facturen versturen. De uitnodiging bleef stil op 'pending'
  // staan; de enige weg terug was zelf de mail opnieuw opzoeken. Voor het kanaal waar het hele
  // product op leunt (één kantoor nodigt vijftig klanten uit) is dat geen scherpe rand maar een
  // gebroken hoofdpad: het faalde juist bij NIEUWE gebruikers, en elke genodigde is er een.
  //
  // De acceptatiepagina stuurt na de tik zelf door naar /dashboard, waar de middleware een vers
  // account alsnog de wizard in leidt — de wizard wordt dus niet overgeslagen, hij komt één
  // stap later. Alleen de acceptatie gaat voor.
  const isInviteAccept = hasNext && next.startsWith("/invite/accept");

  // ── [PROFILE-READ] We could not look ──────────────────────────────────
  //
  // Not "there is no profile", and the difference is every write below. We know nothing about
  // this account: whether it is new, half-configured or finished seven quarters ago. So the plan
  // orders NOTHING — no insert, no upsert, no role, no step, no onboarding_done, no name, no
  // archief — and only routes. The session is real (the code was exchanged before this), so the
  // visitor is signed in; what is unknown is who they are to us.
  //
  // WHERE THEY GO, and why it is not `next`:
  //   · an invitation destination is honoured, because accepting one decides nothing about
  //     profile state — /invite/accept reads the token and the signed-in address, never
  //     onboarding_done — and the token is the one thing that expires while we guess. It is also
  //     already the destination both branches below privilege over everything profile-derived.
  //   · everything else goes HOME. Not `next`, even when `next` is safe: the e-mail confirmation
  //     link always carries next=/onboarding, and sending an unreadable profile to the wizard is
  //     the original bug onboarding-gate.ts names in so many words ("a completed owner walked
  //     into the wizard because a read timed out"). And not the archief landing either — that
  //     page self-heals onboarding_done + account_purpose off ?doel=archief, so choosing to send
  //     an unknown profile there is the markArchief write with one hop in between. The owner who
  //     came for their vault reaches it from the home, and that self-heal still fires when they
  //     open it themselves, which is where it was always meant to happen.
  if (read.kind === "failed") {
    return {
      destination: isInviteAccept ? next : HOME_PATH,
      profileToCreate: null,
      roleUpdate: null,
      markArchief: false,
      backfillName: false,
    };
  }

  const profile = read.kind === "row" ? read.row : null;

  // ── Nog geen profiel ──────────────────────────────────────────────────
  if (!profile) {
    return {
      // [KLUIS] Een archiefaccount heeft geen wizard te doorlopen: die gaat over facturen
      // versturen, bedrijfsgegevens en het koppelen van een mailbox, en deze bezoeker kwam voor
      // geen van drieën.
      destination: wantsArchief ? (hasNext ? next : archiefLanding) : isInviteAccept ? next : "/onboarding",
      profileToCreate: {
        role: chosenRole ?? "zzper",
        onboarding_done: wantsArchief,
        onboarding_step: 1,
      },
      roleUpdate: null,
      markArchief: wantsArchief,
      // The insert above already carries the name; there is nothing to backfill onto.
      backfillName: false,
    };
  }

  // ── Bestaand (meestal: zojuist door de trigger gemaakt) profiel ───────
  const onbeschreven = isOnbeschreven(profile);

  if (wantsArchief && onbeschreven) {
    return {
      destination: hasNext ? next : archiefLanding,
      profileToCreate: null,
      // Rol en doel reizen samen mee; is er een rol gekozen, dan hoort die er ook te staan.
      roleUpdate: chosenRole && chosenRole !== profile.role ? chosenRole : null,
      markArchief: true,
      backfillName: true,
    };
  }

  const roleUpdate = chosenRole && chosenRole !== profile.role && onbeschreven ? chosenRole : null;

  // Een bestaand boekhoudaccount wordt hier NOOIT omgezet naar archief, ook niet met
  // ?doel=archief. Dat blijft aan het zelfherstel op /dashboard/kluis, waar het gebeurt op de
  // pagina die de gebruiker zelf heeft opgevraagd — zichtbaar, en niet als bijwerking van een
  // aanmelding. Zie de toelichting in src/app/dashboard/kluis/page.tsx.
  if (!profile.onboarding_done) {
    return { destination: isInviteAccept ? next : "/onboarding", profileToCreate: null, roleUpdate, markArchief: false, backfillName: true };
  }

  return { destination: next, profileToCreate: null, roleUpdate, markArchief: false, backfillName: true };
}
