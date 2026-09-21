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
import { parseRole, parseRegisterIntent, type Role } from "./register-intent";
import { PURPOSE_PARAM, landingPath, parsePurpose } from "./account-purpose";
import { parseVak } from "./vak-profile";
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
  /**
   * [EERSTE-DEUR] ?registratie= — did this callback come from the registration door?
   *
   * Raw, like the three above, and narrowed by parseRegisterIntent before anything reads it.
   */
  register: string | null;
  /**
   * [VAK-BRUG] ?vak= — the trade the visitor already told us on the way in.
   *
   * Only Google needs to carry it: an e-mail signUp puts it in the metadata and handle_new_user
   * writes it, while an OAuth sign-in carries no metadata at all, so the trade was simply lost.
   */
  vak: string | null;
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
  /**
   * [EERSTE-DEUR] Mark an EXISTING fresh profile as done, so a new account enters the product
   * instead of a wizard. Null means "leave onboarding state alone", which is every other case.
   *
   * The values, not a boolean, because the step is part of the decision: see completedStep().
   * (A brand-new profile does not use this — its completion is baked into profileToCreate, in
   * one INSERT rather than an insert followed by an update.)
   */
  completeFirstRun: { onboarding_done: boolean; onboarding_step: number } | null;
  /**
   * [VAK-BRUG] The trade to write, or null to leave it alone.
   *
   * A SEPARATE field rather than a column inside profileToCreate, and that is the
   * [VANGNET-SPLITSING] lesson repeated: profile_vak.sql is applied by hand, so on a deployment
   * without it PostgREST refuses the WHOLE row (PGRST204) — and folding `vak` into the insert
   * would take the role and the onboarding state down with a column that only decides what the
   * app OFFERS to prefill. Its own write, its own failure.
   */
  vakToSet: string | null;
}

/**
 * [EERSTE-DEUR] The onboarding_step a completed account carries, per role.
 *
 * Not a new value: it is the one the wizard itself leaves behind. OnboardingWizard's own
 * `isDone` is `(role === "zzp" && step === 6) || (role === "accountant" && step === 5)`, and its
 * finish() writes only `{ done: true }` — so a row that finished the wizard keeps the last step it
 * reached. A row completed at the door is therefore indistinguishable from one completed the long
 * way, which is what "completed" should mean.
 *
 * Nothing reads this once onboarding_done is true. Measured: the only readers of onboarding_step
 * are onboarding/page.tsx (initialStep + roleWasSet) and isOnbeschreven below, and that page
 * redirects to /dashboard on onboarding_done before either is used. It is archival, and the honest
 * archival value is the wizard's own.
 *
 * EXPORTED because /register needs the same answer: with e-mail confirmation OFF there is a
 * session immediately and the callback never runs, so that path completes the account itself. Two
 * spellings of one rule is how the two environments would start producing different accounts — the
 * exact divergence those lines exist to prevent — so there is one rule and both callers ask it.
 *
 * A function and not a Record<Role, number>, because `Role` has a third member — 'medewerker',
 * the sales colleague from [ACTING-FOR] — who never registers through this door and has no wizard
 * of his own. A map would force a number to be invented for him; this falls back to the ZZP'er's
 * terminal step, which is what the wizard would do with an unrecognised role anyway.
 */
export function completedStep(role: Role | null | undefined): number {
  return role === "accountant" ? 5 : 6;
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
  // [EERSTE-DEUR] Did this come from the registration door? UX intent, never authorisation —
  // see the header of register-intent.ts for why anyone being able to set it costs nothing.
  const isRegistration = parseRegisterIntent(intent.register);
  // [VAK-BRUG] Narrowed here, once. Anything that is not one of the known slugs becomes null,
  // which means "we do not know his trade" — the state every account was in until now.
  const carriedVak = parseVak(intent.vak);

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
  // De acceptatiepagina stuurt na de tik zelf door naar /dashboard. Wat daar gebeurt hangt af van
  // het account, en dat is sinds [EERSTE-DEUR] niet meer één antwoord — de oude zin hier beweerde
  // nog dat de middleware een vers account "alsnog de wizard in leidt, één stap later", en dat
  // klopt precies voor de nieuwe gebruiker niet meer:
  //
  //   · een genodigde die zich zojuist REGISTREERDE is al afgerond voordat hij accepteert, dus
  //     hij komt na de acceptatie gewoon in het product — er is geen wizard meer die wacht;
  //   · een bestaand account dat de wizard nog open heeft staan, komt er wél in terecht, precies
  //     zoals altijd.
  //
  // Wat in beide gevallen hetzelfde blijft, en het enige wat deze regel beslist: de ACCEPTATIE
  // gaat voor. Het token is het enige dat verloopt terwijl wij ergens anders naartoe wijzen.
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
  //   · everything else goes HOME. Not `next`, even when `next` is safe: a confirmation link can
  //     carry next=/onboarding (every one built before [EERSTE-DEUR] does), and sending an
  //     unreadable profile to the wizard is the original bug onboarding-gate.ts names in so many
  //     words ("a completed owner walked into the wizard because a read timed out"). And not the
  //     archief landing either — that
  //     page self-heals onboarding_done + account_purpose off ?doel=archief, so choosing to send
  //     an unknown profile there is the markArchief write with one hop in between.
  //
  // What this branch promises is therefore exactly one thing, and it is worth stating in the
  // narrow form rather than the comfortable one: SAFE DEGRADATION; NO PROFILE WRITE. It does not
  // promise that the archive visitor reaches their vault, or that anyone reaches any particular
  // screen — #377 established that the home itself may fail honestly, which is the point of
  // sending them there. The guarantee is about what is NOT written, never about where they land.
  //
  // [EERSTE-DEUR] And this branch stands FIRST, above everything the registration flag can reach.
  // "We could not look" outranks "the URL says this is a new account": an unreadable profile is
  // not a fresh one, and completing an onboarding on a read that failed would be the same defect
  // this branch exists to prevent, wearing a friendlier name. A ?registratie=1 on a failed read
  // therefore buys exactly nothing — which is asserted, not assumed.
  if (read.kind === "failed") {
    return {
      destination: isInviteAccept ? next : HOME_PATH,
      profileToCreate: null,
      roleUpdate: null,
      markArchief: false,
      backfillName: false,
      completeFirstRun: null,
      vakToSet: null,
    };
  }

  const profile = read.kind === "row" ? read.row : null;

  // ── Nog geen profiel ──────────────────────────────────────────────────
  if (!profile) {
    // [EERSTE-DEUR] A registration that arrives with no row at all: the trigger did not fire for
    // this account. The row is then created COMPLETE — one INSERT, not an insert followed by a
    // correction — so there is no moment in which a brand-new owner looks like a wizard candidate
    // to the middleware. Archief is not folded in here: that path was already complete on arrival
    // and keeps its own landing, which is the whole of "archive behaviour remains its own flow".
    const freshRegistration = isRegistration && !wantsArchief;
    const newRole: Role = chosenRole ?? "zzper";
    return {
      // [KLUIS] Een archiefaccount heeft geen wizard te doorlopen: die gaat over facturen
      // versturen, bedrijfsgegevens en het koppelen van een mailbox, en deze bezoeker kwam voor
      // geen van drieën.
      // [EERSTE-DEUR] For a registration, `next` IS the priority chain already: safeRedirect gave
      // it the invitation when one travelled, the requested destination when one was safe, and
      // HOME_PATH when neither. No second destination engine.
      destination: wantsArchief
        ? (hasNext ? next : archiefLanding)
        : freshRegistration
          ? next
          : isInviteAccept ? next : "/onboarding",
      profileToCreate: {
        role: newRole,
        onboarding_done: wantsArchief || freshRegistration,
        onboarding_step: freshRegistration ? completedStep(newRole) : 1,
      },
      roleUpdate: null,
      markArchief: wantsArchief,
      // The insert above already carries the name; there is nothing to backfill onto.
      backfillName: false,
      // Completion is inside the insert above — there is no existing row to correct.
      completeFirstRun: null,
      // [VAK-BRUG] Its own write, never a column in the insert — see the field's own comment.
      vakToSet: freshRegistration ? carriedVak : null,
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
      // markArchief already writes onboarding_done for this path; completing it twice, with a
      // step this visitor never walked, would say something that is not true of him.
      completeFirstRun: null,
      vakToSet: null,
    };
  }

  const roleUpdate = chosenRole && chosenRole !== profile.role && onbeschreven ? chosenRole : null;

  // [EERSTE-DEUR] A registration whose row the trigger DID create — the ordinary case, because
  // on_auth_user_created fires during exchangeCodeForSession.
  //
  // `onbeschreven` is the whole guard, and it is deliberately the SAME predicate that already
  // decides whether a URL may still write the role: not done, and step 1 or lower. That is what
  // makes "fresh" mean fresh. `!onboarding_done` alone would be catastrophic here — production
  // holds profiles parked at steps 4, 5 and 6 with onboarding_done false, and every one of them
  // would be silently marked finished the next time its owner signed in, skipping the wizard they
  // were half-way through and losing the screens that collect their KvK, address and IBAN.
  //
  // A registration that is somehow past step 1 therefore falls through to the legacy branch and
  // resumes, which is the safe direction: a wizard too many costs a few screens, and completing
  // someone who is not finished costs the data those screens exist to collect.
  const isFreshRegistration = isRegistration && onbeschreven && !profile.onboarding_done;

  // Een bestaand boekhoudaccount wordt hier NOOIT omgezet naar archief, ook niet met
  // ?doel=archief. Dat blijft aan het zelfherstel op /dashboard/kluis, waar het gebeurt op de
  // pagina die de gebruiker zelf heeft opgevraagd — zichtbaar, en niet als bijwerking van een
  // aanmelding. Zie de toelichting in src/app/dashboard/kluis/page.tsx.
  if (isFreshRegistration) {
    // The role this account ends up with — the one travelling on the URL if it may still be
    // written, otherwise whatever the trigger put there. COMPLETED_STEP has to agree with it, or
    // an accountant would be stamped with the ZZP'er's terminal step.
    const finalRole: Role = roleUpdate ?? (profile.role === "accountant" ? "accountant" : "zzper");
    return {
      // Same chain as the insert branch: the invitation, then the requested destination, then
      // home — all three already resolved into `next`. [SEC-REDIRECT] an unsafe one became
      // HOME_PATH long before this line.
      destination: next,
      profileToCreate: null,
      roleUpdate,
      markArchief: false,
      backfillName: true,
      completeFirstRun: { onboarding_done: true, onboarding_step: completedStep(finalRole) },
      vakToSet: carriedVak,
    };
  }

  if (!profile.onboarding_done) {
    return { destination: isInviteAccept ? next : "/onboarding", profileToCreate: null, roleUpdate, markArchief: false, backfillName: true, completeFirstRun: null, vakToSet: null };
  }

  return { destination: next, profileToCreate: null, roleUpdate, markArchief: false, backfillName: true, completeFirstRun: null, vakToSet: null };
}
