// [KLUIS][OAUTH-ROL] Pure node test — run: npx tsx --test src/lib/auth-landing.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { planAfterOAuth, type CallbackIntent, type CallbackPlan, type CallbackProfile } from "./auth-landing";
import type { ProfileRead } from "./profile-read";

// Bij Google maakt de trigger het profiel aan tijdens exchangeCodeForSession: de rij bestaat al
// als de callback kijkt, maar is kaal — een OAuth-aanmelding draagt geen signUp-metadata.
const kaal: CallbackProfile = { role: "zzper", onboarding_done: false, onboarding_step: 1 };
const halverwege: CallbackProfile = { role: "accountant", onboarding_done: false, onboarding_step: 3 };
const klaar: CallbackProfile = { role: "zzper", onboarding_done: true, onboarding_step: 6 };

// [PROFILE-READ] The three answers, as fixtures. The wrapping is what this parameter gained:
// every case above still asks exactly what it asked, of a read that SUCCEEDED and found a row.
const row = (profile: CallbackProfile): ProfileRead<CallbackProfile> => ({ kind: "row", row: profile });
/** The read succeeded and there is no row — a fresh account whose trigger did not fire. */
const MISSING: ProfileRead<CallbackProfile> = { kind: "missing" };
/** We could not look. A real one: Postgres cancelling a statement that ran past its timeout. */
const UNREADABLE: ProfileRead<CallbackProfile> = {
  kind: "failed",
  code: "57014",
  message: "canceling statement due to statement timeout",
};

const geen = { next: null, role: null, purpose: null, register: null, vak: null };

test("een gewone Google-registratie gaat de wizard in", () => {
  const plan = planAfterOAuth({ ...geen, role: "zzper" }, row(kaal));
  assert.equal(plan.destination, "/onboarding");
  assert.equal(plan.markArchief, false);
  assert.equal(plan.roleUpdate, null); // stond al op zzper — niets te schrijven
});

test("de boekhouder uit stap 1 wordt ook echt boekhouder", () => {
  // Dit is de reparatie: de rol reisde niet mee en de callback schreef onvoorwaardelijk 'zzper'.
  const plan = planAfterOAuth({ ...geen, role: "accountant" }, row(kaal));
  assert.equal(plan.roleUpdate, "accountant");
  assert.equal(plan.destination, "/onboarding");
});

test("een profiel dat de rolvraag al gepasseerd is wordt niet aangeraakt", () => {
  // Halverwege de wizard (stap 3) en na afronding: de keuze is daar gemaakt, niet in een URL.
  assert.equal(planAfterOAuth({ ...geen, role: "zzper" }, row(halverwege)).roleUpdate, null);
  assert.equal(planAfterOAuth({ ...geen, role: "accountant" }, row(klaar)).roleUpdate, null);
});

test("een onbekende rol schrijft niets", () => {
  for (const rol of ["admin", "client", "", "ZZPER"]) {
    assert.equal(planAfterOAuth({ ...geen, role: rol }, row(kaal)).roleUpdate, null, rol);
  }
});

test("het archiefpad landt in de kluis en niet in de wizard", () => {
  // De fout die dit bestand bestaat om te vangen: `next` wees al naar de kluis, maar de regel
  // "stuur elke nieuwe gebruiker naar /onboarding" stond ervóór en won altijd.
  const plan = planAfterOAuth(
    { next: "/dashboard/kluis?doel=archief", role: "zzper", purpose: "archief", register: null, vak: null },
    row(kaal),
  );
  assert.equal(plan.destination, "/dashboard/kluis?doel=archief");
  assert.equal(plan.markArchief, true);
});

test("het archiefpad werkt ook zonder meegegeven bestemming", () => {
  const plan = planAfterOAuth({ ...geen, purpose: "archief" }, row(kaal));
  assert.equal(plan.destination, "/dashboard/kluis?doel=archief");
  assert.equal(plan.markArchief, true);
});

test("draaide de trigger niet, dan maken wij het archiefprofiel zelf — zonder wizard", () => {
  const plan = planAfterOAuth({ ...geen, role: "zzper", purpose: "archief" }, MISSING);
  assert.deepEqual(plan.profileToCreate, {
    role: "zzper",
    onboarding_done: true, // geen wizard over facturen voor wie zijn zaak komt wegzetten
    onboarding_step: 1,
  });
  assert.equal(plan.destination, "/dashboard/kluis?doel=archief");
  assert.equal(plan.markArchief, true);
});

test("zonder profiel en zonder archiefdoel: gewoon de wizard", () => {
  const plan = planAfterOAuth({ ...geen, role: "accountant" }, MISSING);
  assert.deepEqual(plan.profileToCreate, {
    role: "accountant",
    onboarding_done: false,
    onboarding_step: 1,
  });
  assert.equal(plan.destination, "/onboarding");
});

test("een meegegeven bestemming gaat vóór de standaardlanding van het archiefpad", () => {
  // Wie via een uitnodiging binnenkomt hoort bij die uitnodiging uit te komen, ook als hij
  // tegelijk een archiefaccount aanmaakt.
  const plan = planAfterOAuth(
    { next: "/invite/accept?token=abc", role: "zzper", purpose: "archief", register: null, vak: null },
    row(kaal),
  );
  assert.equal(plan.destination, "/invite/accept?token=abc");
  assert.equal(plan.markArchief, true);
});

test("een bestaand, afgerond account wordt hier nooit omgezet naar archief", () => {
  // Dat blijft aan het zelfherstel op /dashboard/kluis: zichtbaar, op de pagina die de gebruiker
  // zelf opvroeg, en niet als bijwerking van een aanmelding.
  const plan = planAfterOAuth(
    { next: "/dashboard/kluis?doel=archief", role: null, purpose: "archief", register: null, vak: null },
    row(klaar),
  );
  assert.equal(plan.markArchief, false);
  assert.equal(plan.destination, "/dashboard/kluis?doel=archief"); // de kluis herstelt het daar
});

test("een gewone login komt uit waar hij altijd uitkwam", () => {
  assert.equal(planAfterOAuth(geen, row(klaar)).destination, "/dashboard");
  assert.equal(planAfterOAuth({ ...geen, next: "/dashboard/facturen" }, row(klaar)).destination, "/dashboard/facturen");
  assert.equal(planAfterOAuth(geen, row(kaal)).destination, "/onboarding");
  assert.equal(planAfterOAuth(geen, row(halverwege)).destination, "/onboarding");
});

test("[SEC-REDIRECT] een vreemde bestemming haalt het nooit — ook niet via het archiefpad", () => {
  for (const kwaad of ["https://evil.nl", "//evil.nl", "javascript:alert(1)", "/\\evil.nl"]) {
    assert.equal(planAfterOAuth({ ...geen, next: kwaad }, row(klaar)).destination, "/dashboard", kwaad);
    assert.equal(
      planAfterOAuth({ ...geen, next: kwaad, purpose: "archief" }, row(kaal)).destination,
      "/dashboard/kluis?doel=archief",
      kwaad,
    );
  }
});

// ── [UITNODIGING] De uitnodigingslink wint van de wizard ────────────────────────────────────────
//
// Tweede keer dezelfde les als het archiefpad in de kop van auth-landing.ts: `next` wees goed,
// de onboarding-regel stond ervóór en won. Hier was de schade groter — de genodigde klant van
// een kantoor registreerde, bevestigde zijn mail, en het token verdween: uitnodiging bleef stil
// 'pending'. Het hoofdpad van het distributiekanaal faalde precies bij nieuwe gebruikers, en
// elke genodigde is er een.

test("[UITNODIGING] een vers account met een uitnodigingsbestemming gaat EERST accepteren", () => {
  const next = "/invite/accept?token=abc-123";
  // Nog geen profiel (e-mailbevestiging maakte het net aan): de uitnodiging gaat voor.
  assert.equal(planAfterOAuth({ next, role: null, purpose: null, register: null, vak: null }, MISSING).destination, next);
  // Kaal profiel (trigger was sneller): zelfde antwoord.
  assert.equal(planAfterOAuth({ next, role: null, purpose: null, register: null, vak: null }, row(kaal)).destination, next);
  // Halverwege de wizard: de uitnodiging gaat nog steeds voor — de acceptatiepagina stuurt na de
  // tik zelf naar /dashboard, waar de middleware hem de wizard weer in leidt. Niets slaat over.
  assert.equal(planAfterOAuth({ next, role: null, purpose: null, register: null, vak: null }, row(halverwege)).destination, next);
});

test("[UITNODIGING] alleen een ECHTE uitnodigingsbestemming wint — niet een gewone next", () => {
  // De regel is smal met opzet: elke andere bestemming blijft achter de wizard staan, precies
  // zoals altijd. Anders wordt "next wint" de nieuwe standaard en is de wizard optioneel
  // geworden als bijwerking.
  assert.equal(
    planAfterOAuth({ next: "/dashboard/facturen", role: null, purpose: null, register: null, vak: null }, row(kaal)).destination,
    "/onboarding",
  );
  // [SEC-REDIRECT] Een vreemde origin blijft geweigerd; de terugval is /dashboard en een vers
  // account gaat dan gewoon de wizard in.
  assert.equal(
    planAfterOAuth({ next: "https://evil.example/invite/accept?token=x", role: null, purpose: null, register: null, vak: null }, row(kaal)).destination,
    "/onboarding",
  );
});

// ── [PROFILE-READ] A read that FAILED is not a profile that is MISSING ──────────────────────────
//
// The fourth reader of this table, and the one that was missed when the middleware, /dashboard and
// /onboarding were converted. It is also the only one that WRITES on "missing", which is what made
// the confusion expensive: `data` alone cannot tell a refused or timed-out read from a fresh
// account, so one hiccup upserted role / onboarding_step / onboarding_done / full_name over a
// profile that already existed. Worst shape: a finished accountant signing in with Google brings
// no ?rol=, so the plan fell back to 'zzper' — demoted, onboarding_done false, into the wizard.
//
// Eight cases: two that must write nothing, four that must be exactly what they were, and two that
// pin the boundary the smoother path must not quietly widen.

/**
 * The whole plan, in one comparison: a failed read may ROUTE, and may order no write at all.
 *
 * deepEqual over the complete object rather than four field assertions, on purpose — a fifth
 * write added to CallbackPlan later fails this test instead of travelling through it unasserted.
 */
function assertRoutesOnly(plan: CallbackPlan, destination: string, why: string) {
  assert.deepEqual(
    plan,
    {
      destination,
      profileToCreate: null,
      roleUpdate: null,
      markArchief: false,
      backfillName: false,
      completeFirstRun: null,
      vakToSet: null,
    },
    `${why}: an unreadable profile may be routed and must never be written`,
  );
}

test("[PROFILE-READ] 1 — a finished accountant survives an unreadable read untouched", () => {
  const afgerond: CallbackProfile = { role: "accountant", onboarding_done: true, onboarding_step: 5 };
  // Exactly the production shape of the bug: /login's Google button carries `next` and no ?rol=.
  assertRoutesOnly(
    planAfterOAuth({ next: "/dashboard/accountant", role: null, purpose: null, register: null, vak: null }, UNREADABLE),
    "/dashboard",
    "a completed accountant",
  );
  // And the same account read successfully still goes where it always went — proof that the
  // fixture above is not simply a shape the function never routes anywhere.
  assert.equal(
    planAfterOAuth({ next: "/dashboard/accountant", role: null, purpose: null, register: null, vak: null }, row(afgerond)).destination,
    "/dashboard/accountant",
  );
});

test("[PROFILE-READ] 2 — a finished ZZP'er survives an unreadable read untouched", () => {
  assertRoutesOnly(planAfterOAuth(geen, UNREADABLE), "/dashboard", "a completed ZZP'er");
  // With a role travelling along, which is the value that would otherwise be written.
  assertRoutesOnly(
    planAfterOAuth({ ...geen, role: "zzper" }, UNREADABLE),
    "/dashboard",
    "…even with ?rol= on the callback",
  );
});

test("[PROFILE-READ] 3 — a genuinely missing profile is still created", () => {
  // The one case in which creating a row is right, and the reason "failed" may not borrow it.
  const plan = planAfterOAuth({ ...geen, role: "accountant" }, MISSING);
  assert.deepEqual(plan.profileToCreate, {
    role: "accountant",
    onboarding_done: false,
    onboarding_step: 1,
  });
  assert.equal(plan.destination, "/onboarding");
  assert.equal(plan.backfillName, false, "the insert carries the name; there is nothing to backfill");
});

test("[PROFILE-READ] 4 — an existing, incomplete profile behaves exactly as before", () => {
  // Bare row, role travelling along: still the wizard, still the role write, still no insert.
  const vers = planAfterOAuth({ ...geen, role: "accountant" }, row(kaal));
  assert.deepEqual(vers, {
    destination: "/onboarding",
    profileToCreate: null,
    roleUpdate: "accountant",
    markArchief: false,
    backfillName: true,
    completeFirstRun: null,
    vakToSet: null,
  });
  // Half-way through the wizard: the URL may no longer overwrite a choice made inside the app.
  const midden = planAfterOAuth({ ...geen, role: "zzper" }, row(halverwege));
  assert.deepEqual(midden, {
    destination: "/onboarding",
    profileToCreate: null,
    roleUpdate: null,
    markArchief: false,
    backfillName: true,
    completeFirstRun: null,
    vakToSet: null,
  });
});

test("[PROFILE-READ] 5 — an invitation destination survives an unreadable read", () => {
  // The one `next` that is honoured on a failed read, because accepting decides nothing about
  // profile state — and because the token expires while we would be guessing.
  const next = "/invite/accept?token=abc-123";
  assertRoutesOnly(planAfterOAuth({ next, role: null, purpose: null, register: null, vak: null }, UNREADABLE), next, "an invited client");
  // Still nothing written, even with a role and an archive purpose riding along with it.
  assertRoutesOnly(
    planAfterOAuth({ next, role: "accountant", purpose: "archief", register: null, vak: null }, UNREADABLE),
    next,
    "an invitation with every other parameter set",
  );
});

test("[PROFILE-READ] 6 — an unsafe next is still refused on a failed read", () => {
  // [SEC-REDIRECT] The failed branch reads the same validated value as every other branch; it
  // must not become a second door where a raw querystring reaches a redirect.
  for (const kwaad of [
    "https://evil.nl/invite/accept?token=x",
    "//evil.nl/invite/accept",
    "javascript:alert(1)",
    "/\\evil.nl/invite/accept",
    "/invite/accept\u0000",
  ]) {
    assertRoutesOnly(planAfterOAuth({ next: kwaad, role: null, purpose: null, register: null, vak: null }, UNREADABLE), "/dashboard", kwaad);
  }
});

test("[PROFILE-READ] 7 — the archive path is untouched where the read succeeds", () => {
  // Fresh archive account, both entrances: with the landing carried on ?next= (what /register
  // actually sends) and without it.
  const metBestemming = planAfterOAuth(
    { next: "/dashboard/kluis?doel=archief", role: "zzper", purpose: "archief", register: null, vak: null },
    row(kaal),
  );
  assert.equal(metBestemming.destination, "/dashboard/kluis?doel=archief");
  assert.equal(metBestemming.markArchief, true);
  assert.equal(planAfterOAuth({ ...geen, purpose: "archief" }, MISSING).markArchief, true);

  // And on a failed read the archive landing is NOT synthesised: that page self-heals
  // onboarding_done + account_purpose off ?doel=archief, so routing an unknown profile there is
  // the markArchief write with one hop in between. Home, where the honest screen is.
  assertRoutesOnly(
    planAfterOAuth({ next: "/dashboard/kluis?doel=archief", role: "zzper", purpose: "archief", register: null, vak: null }, UNREADABLE),
    "/dashboard",
    "an archive registration whose profile could not be read",
  );
});

test("[PROFILE-READ] 8 — no failed read can demote a role or reset onboarding state", () => {
  // The class, swept rather than sampled: every combination of the parameters that can reach this
  // function, against a read that failed. None of them may produce a write.
  const nexts = [null, "/dashboard", "/onboarding", "/dashboard/kluis?doel=archief", "/invite/accept?token=t"];
  const roles = [null, "zzper", "accountant", "client", "admin", ""];
  const purposes = [null, "archief", "boekhouden", "ARCHIEF"];
  // [EERSTE-DEUR] The registration flag joins the sweep, and this is required test 10: a URL that
  // claims to be a fresh registration must not buy a single write out of a read that failed. The
  // flag is attacker-settable by design (see register-intent.ts), so "it cannot reach the writes"
  // has to be a measured property of every combination, not a claim about branch order.
  const registers = [null, "1", "0", "true", ""];

  for (const next of nexts) {
    for (const role of roles) {
      for (const purpose of purposes) {
        for (const register of registers) {
          const plan = planAfterOAuth({ next, role, purpose, register, vak: "kapper" }, UNREADABLE);
          const why = `next=${next} role=${role} doel=${purpose} registratie=${register}`;
          assert.equal(plan.profileToCreate, null, `${why}: no INSERT/UPSERT`);
          assert.equal(plan.roleUpdate, null, `${why}: no role write — this is the demotion`);
          assert.equal(plan.markArchief, false, `${why}: no onboarding_done / account_purpose write`);
          assert.equal(plan.backfillName, false, `${why}: no full_name overwrite`);
          assert.equal(plan.completeFirstRun, null, `${why}: no onboarding completion`);
          assert.equal(plan.vakToSet, null, `${why}: no trade write`);
          // [SEC-REDIRECT] And wherever it routes, it is a path on our own origin.
          assert.match(plan.destination, /^\/(?![/\\])/, `${why}: destination stays on our origin`);
        }
      }
    }
  }
});

// ── [EERSTE-DEUR] A new account enters the product, not a wizard ────────────────────────────────
//
// The audit measured what a brand-new ZZP'er actually met after confirming their e-mail: "Wil je
// je Gmail koppelen?", labelled "Stap 3 van 5", on the first screen they had ever seen — followed
// by an accountant invitation and a slot screen that told them they were "Bijna klaar" and should
// go to Instellingen. Six screens between deciding to join and seeing the product, four of which
// collected nothing that was needed to get in.
//
// The rule below is one line wide: a REGISTRATION whose profile is genuinely FRESH is finished at
// the door. Everything else in this file must keep behaving exactly as it did, and most of these
// cases exist to prove that rather than to prove the new behaviour.

/** A registration, as /register builds it: the flag, plus whatever else travelled. */
const registratie = (over: Partial<CallbackIntent> = {}): CallbackIntent => ({
  ...geen, register: "1", ...over,
});

/** The two shapes a genuinely fresh profile takes when the callback looks. */
const versGoogle: CallbackProfile = { role: "zzper", onboarding_done: false, onboarding_step: 1 };
const versEmail: CallbackProfile = { role: "zzper", onboarding_done: false, onboarding_step: 1 };

test("[EERSTE-DEUR] 1 — a fresh e-mail ZZP registration is finished at the door", () => {
  // After the metadata change /register no longer sends onboarding_step: 4, so handle_new_user
  // falls back to its own default of 1 — which is what makes this profile "fresh" at all.
  const plan = planAfterOAuth(registratie({ role: "zzper" }), row(versEmail));
  assert.deepEqual(plan.completeFirstRun, { onboarding_done: true, onboarding_step: 6 },
    "the ZZP'er's terminal step is the one the wizard itself leaves behind");
  assert.equal(plan.destination, "/dashboard", "…and he lands in the product, not in /onboarding");
  assert.equal(plan.profileToCreate, null, "the trigger already made the row");
});

test("[EERSTE-DEUR] 2 — a fresh Google ZZP'er is never asked his role a second time", () => {
  // The audit's finding B: the role chosen at the door was written, but 'zzper' is also the
  // trigger's default, so the wizard could not tell a choice from a default and asked again. The
  // question cannot be asked twice if the wizard is not entered at all.
  const plan = planAfterOAuth(registratie({ role: "zzper" }), row(versGoogle));
  assert.notEqual(plan.destination, "/onboarding", "the wizard is where the second question lives");
  assert.equal(plan.destination, "/dashboard");
  assert.deepEqual(plan.completeFirstRun, { onboarding_done: true, onboarding_step: 6 });
  assert.equal(plan.roleUpdate, null, "'zzper' was already on the row — nothing to write");
});

test("[EERSTE-DEUR] 3 — a fresh Google accountant is completed AS an accountant", () => {
  // Two things at once, and the second is the one that could silently rot: the role has to be
  // written before the terminal step is chosen, or an accountant gets stamped with the ZZP'er's
  // step 6. The row still says 'zzper' here — the trigger's default — so the plan must use the
  // role it is about to write, not the one it read.
  const plan = planAfterOAuth(registratie({ role: "accountant" }), row(versGoogle));
  assert.equal(plan.roleUpdate, "accountant", "the choice at the door is written");
  assert.deepEqual(plan.completeFirstRun, { onboarding_done: true, onboarding_step: 5 },
    "the accountant's terminal step, not the ZZP'er's");
  assert.equal(plan.destination, "/dashboard",
    "the product entry — /dashboard performs the role routing to the accountant portal");
});

test("[EERSTE-DEUR] 4 — the trade survives a Google registration", () => {
  // The factual loss the audit proved: ?vak= reached the metadata on the e-mail path and was
  // dropped entirely on Google, because an OAuth sign-in carries no signUp metadata at all.
  const plan = planAfterOAuth(registratie({ role: "zzper", vak: "kapper" }), row(versGoogle));
  assert.equal(plan.vakToSet, "kapper", "the trade he told us on the landing page is kept");

  // [VAK-BRUG] Only a slug the vocabulary knows. A wrong trade would prefill another profession's
  // btw rates, which is the one outcome that module exists to prevent.
  for (const rommel of ["notaris", "", "'; drop table", "kapper ", null]) {
    assert.equal(planAfterOAuth(registratie({ vak: rommel }), row(versGoogle)).vakToSet,
      rommel === "kapper " ? "kapper" : null, String(rommel));
  }
  // …and a slug the vocabulary DOES know is normalised rather than refused — parseVak trims and
  // lower-cases, so a landing page that shouts its own slug still lands on the same trade.
  assert.equal(planAfterOAuth(registratie({ vak: "KAPPER " }), row(versGoogle)).vakToSet, "kapper");

  // And never onto an account that already exists in its own right. Authenticating through a URL
  // that happens to carry ?vak= may not rewrite the trade of a finished owner.
  assert.equal(planAfterOAuth(registratie({ vak: "kapper" }), row(klaar)).vakToSet, null,
    "a completed account's trade is not touched");
  assert.equal(planAfterOAuth(registratie({ vak: "kapper" }), row(halverwege)).vakToSet, null,
    "…nor is one half-way through the legacy wizard");
  assert.equal(planAfterOAuth({ ...geen, vak: "kapper" }, row(versGoogle)).vakToSet, null,
    "…nor on an ordinary sign-in that never claimed to be a registration");
});

test("[EERSTE-DEUR] 5 — an invitation still wins, even over a finished registration", () => {
  // [UITNODIGING] Token continuity outranks the generic landing. The invited client registers,
  // is completed at the door, and STILL lands on the acceptance page — the accept page sends him
  // to /dashboard itself afterwards, where nothing stands in his way any more.
  const next = "/invite/accept?token=abc-123";
  for (const [naam, lezing] of [["a fresh row", row(versGoogle)], ["no row at all", MISSING]] as const) {
    const plan = planAfterOAuth(registratie({ next, role: "zzper" }), lezing);
    assert.equal(plan.destination, next, `${naam}: the invitation is still the destination`);
  }
  // A safe destination that is not an invitation is honoured too — it is what the visitor asked
  // for, and it is no longer /onboarding by accident (see bevestigingsBestemming in register).
  assert.equal(
    planAfterOAuth(registratie({ next: "/dashboard/facturen" }), row(versGoogle)).destination,
    "/dashboard/facturen",
  );
});

test("[EERSTE-DEUR] 6 — the archive flow is untouched by the registration flag", () => {
  // Archive was already complete on arrival: handle_new_user sets onboarding_done from the
  // purpose, and markArchief writes it again for Google. Completing it a second time, with a
  // terminal step this visitor never walked, would state something untrue about him.
  const plan = planAfterOAuth(
    registratie({ next: "/dashboard/kluis?doel=archief", role: "zzper", purpose: "archief" }),
    row(versGoogle),
  );
  assert.equal(plan.destination, "/dashboard/kluis?doel=archief", "still the vault");
  assert.equal(plan.markArchief, true, "still marked as an archive account");
  assert.equal(plan.completeFirstRun, null, "archive does not borrow the registration completion");

  // And with no row at all, the created profile is the archive one, not the registration one.
  const vers = planAfterOAuth(registratie({ role: "zzper", purpose: "archief" }), MISSING);
  assert.deepEqual(vers.profileToCreate, { role: "zzper", onboarding_done: true, onboarding_step: 1 },
    "the archive insert keeps its own shape — step 1, because no wizard was walked");
  assert.equal(vers.destination, "/dashboard/kluis?doel=archief");
});

test("[EERSTE-DEUR] 7 — a legacy owner parked at step 4 resumes the wizard, untouched", () => {
  // The compatibility requirement this whole batch is shaped by. Production holds profiles at
  // steps 4, 5 and 6 with onboarding_done false. Every one of them must still land where it was.
  const stap4: CallbackProfile = { role: "zzper", onboarding_done: false, onboarding_step: 4 };
  for (const [naam, bedoeling] of [
    ["an ordinary sign-in", geen],
    ["…and even one carrying the registration flag", registratie()],
  ] as const) {
    const plan = planAfterOAuth(bedoeling, row(stap4));
    assert.equal(plan.destination, "/onboarding", `${naam}: he resumes`);
    assert.equal(plan.completeFirstRun, null, `${naam}: he is NOT silently finished`);
    assert.equal(plan.profileToCreate, null, `${naam}: no row is created over his`);
    assert.equal(plan.vakToSet, null, `${naam}: his trade is not rewritten`);
  }
});

test("[EERSTE-DEUR] 8 — a legacy accountant at step 5 is not auto-completed either", () => {
  // Step 5 is the accountant's LAST screen — "Je bent klaar" with the button that calls finish().
  // Completing him from here would skip the one screen that invites his first client, which is
  // his entire first value.
  const stap5: CallbackProfile = { role: "accountant", onboarding_done: false, onboarding_step: 5 };
  const plan = planAfterOAuth(registratie({ role: "accountant" }), row(stap5));
  assert.equal(plan.destination, "/onboarding");
  assert.equal(plan.completeFirstRun, null, "onboarding_done stays false until HE presses the button");
  assert.equal(plan.roleUpdate, null, "and a URL may not rewrite the role of someone past step 1");
});

test("[EERSTE-DEUR] 9 — a completed account signs in exactly as before", () => {
  for (const bedoeling of [geen, registratie(), registratie({ role: "accountant", vak: "kapper" })]) {
    const plan = planAfterOAuth({ ...bedoeling, next: "/dashboard/facturen" }, row(klaar));
    assert.equal(plan.destination, "/dashboard/facturen");
    assert.equal(plan.completeFirstRun, null, "already done — nothing to complete");
    assert.equal(plan.profileToCreate, null);
    assert.equal(plan.markArchief, false);
    assert.equal(plan.vakToSet, null);
    assert.equal(plan.roleUpdate, null, "a finished owner's role is never rewritten from a URL");
  }
});

test("[EERSTE-DEUR] 11 — an unsafe destination is refused even on a registration", () => {
  // [SEC-REDIRECT] The registration branch reads the same validated value as every other branch.
  // A new door must not become a new way for a raw querystring to reach a redirect.
  for (const kwaad of [
    "https://evil.nl", "//evil.nl", "javascript:alert(1)", "/\\evil.nl",
    "https://evil.example/invite/accept?token=x", "/invite/accept\u0000",
  ]) {
    for (const lezing of [row(versGoogle), MISSING] as const) {
      const plan = planAfterOAuth(registratie({ next: kwaad, role: "zzper" }), lezing);
      assert.equal(plan.destination, "/dashboard", kwaad);
      assert.match(plan.destination, /^\/(?![/\\])/, kwaad);
    }
  }
});

test("[EERSTE-DEUR] the completion is created in ONE insert when there is no row", () => {
  // A registration whose trigger did not fire. The row is created complete rather than created
  // and then corrected, so there is no window in which the middleware sees a wizard candidate.
  const zzp = planAfterOAuth(registratie({ role: "zzper", vak: "kapper" }), MISSING);
  assert.deepEqual(zzp.profileToCreate, { role: "zzper", onboarding_done: true, onboarding_step: 6 });
  assert.equal(zzp.completeFirstRun, null, "no second write to correct what the insert already said");
  assert.equal(zzp.vakToSet, "kapper", "the trade is still its own write — never a column in that insert");
  assert.equal(zzp.destination, "/dashboard");

  const acct = planAfterOAuth(registratie({ role: "accountant" }), MISSING);
  assert.deepEqual(acct.profileToCreate, { role: "accountant", onboarding_done: true, onboarding_step: 5 });

  // No role on the URL at all: the trigger's own default, and the ZZP'er's terminal step with it.
  const kaalRegistratie = planAfterOAuth(registratie(), MISSING);
  assert.deepEqual(kaalRegistratie.profileToCreate, { role: "zzper", onboarding_done: true, onboarding_step: 6 });
});

test("[EERSTE-DEUR] only the exact flag counts as a registration", () => {
  // parseRegisterIntent is an exact match, and the fail direction is "this is an ordinary
  // sign-in" — which costs at most one wizard too many, where the opposite would complete an
  // onboarding nobody finished.
  for (const bijna of [null, "", "0", "true", "yes", "11", " 1", "1 "]) {
    const plan = planAfterOAuth({ ...geen, register: bijna }, row(versGoogle));
    assert.equal(plan.completeFirstRun, null, `registratie=${JSON.stringify(bijna)} must not complete`);
    assert.equal(plan.destination, "/onboarding", `registratie=${JSON.stringify(bijna)} is an ordinary sign-in`);
  }
});

test("[EERSTE-DEUR] 10 — what `onbeschreven` can and cannot tell apart, stated on purpose", () => {
  // An adversarial read of this batch raised it, and it is true: a row at step 1 with
  // onboarding_done false is BYTE-IDENTICAL whether the trigger wrote it two seconds ago or a
  // visitor opened the wizard months ago and closed the tab before pressing Volgende once (the
  // first persistStep is on the 1→2 transition). No predicate over this row can separate them,
  // and this batch adds no column to try.
  //
  // So the separation is made by the DOOR instead, and that is the whole reason the flag exists:
  //   · /login never sets it, so signing in can never complete anyone — the requirement in full;
  //   · /register sets it, so the only way into this branch is to go back to the registration
  //     door and register again, which is a deliberate act with the outcome it asks for.
  //
  // What such a visitor gets is exactly what any account created after this batch gets: an
  // account with no company data and no wizard. That is the state this batch chose; arriving at
  // it a second way is not a new harm. Written down because the next reader's instinct will be to
  // "tighten" this, and tightening it means inventing a provenance column the brief forbids.
  const stap1 = { role: "zzper", onboarding_done: false, onboarding_step: 1 } as CallbackProfile;
  const nul = { role: "zzper", onboarding_done: false, onboarding_step: 0 } as CallbackProfile;

  for (const [naam, rij] of [["step 1", stap1], ["step 0, the column default", nul]] as const) {
    // Through the registration door: completed, and it says so rather than happening quietly.
    assert.deepEqual(planAfterOAuth(registratie(), row(rij)).completeFirstRun,
      { onboarding_done: true, onboarding_step: 6 }, `${naam}: the registration door completes`);
    // Through any other door — which is every ordinary sign-in: untouched, wizard intact.
    assert.equal(planAfterOAuth(geen, row(rij)).completeFirstRun, null,
      `${naam}: signing in must never complete anyone`);
    assert.equal(planAfterOAuth(geen, row(rij)).destination, "/onboarding",
      `${naam}: …and must still resume the wizard`);
  }

  // And the moment a visitor has actually walked one step of the wizard, even the registration
  // door leaves them alone — step 2 is already past `onbeschreven`.
  const stap2 = { role: "zzper", onboarding_done: false, onboarding_step: 2 } as CallbackProfile;
  assert.equal(planAfterOAuth(registratie(), row(stap2)).completeFirstRun, null,
    "one Volgende is enough to be a resumer rather than a registrant");
  assert.equal(planAfterOAuth(registratie(), row(stap2)).destination, "/onboarding");
});
