// [KLUIS][OAUTH-ROL] Pure node test — run: npx tsx --test src/lib/auth-landing.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";

import { planAfterOAuth, type CallbackPlan, type CallbackProfile } from "./auth-landing";
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

const geen = { next: null, role: null, purpose: null };

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
    { next: "/dashboard/kluis?doel=archief", role: "zzper", purpose: "archief" },
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
    { next: "/invite/accept?token=abc", role: "zzper", purpose: "archief" },
    row(kaal),
  );
  assert.equal(plan.destination, "/invite/accept?token=abc");
  assert.equal(plan.markArchief, true);
});

test("een bestaand, afgerond account wordt hier nooit omgezet naar archief", () => {
  // Dat blijft aan het zelfherstel op /dashboard/kluis: zichtbaar, op de pagina die de gebruiker
  // zelf opvroeg, en niet als bijwerking van een aanmelding.
  const plan = planAfterOAuth(
    { next: "/dashboard/kluis?doel=archief", role: null, purpose: "archief" },
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
  assert.equal(planAfterOAuth({ next, role: null, purpose: null }, MISSING).destination, next);
  // Kaal profiel (trigger was sneller): zelfde antwoord.
  assert.equal(planAfterOAuth({ next, role: null, purpose: null }, row(kaal)).destination, next);
  // Halverwege de wizard: de uitnodiging gaat nog steeds voor — de acceptatiepagina stuurt na de
  // tik zelf naar /dashboard, waar de middleware hem de wizard weer in leidt. Niets slaat over.
  assert.equal(planAfterOAuth({ next, role: null, purpose: null }, row(halverwege)).destination, next);
});

test("[UITNODIGING] alleen een ECHTE uitnodigingsbestemming wint — niet een gewone next", () => {
  // De regel is smal met opzet: elke andere bestemming blijft achter de wizard staan, precies
  // zoals altijd. Anders wordt "next wint" de nieuwe standaard en is de wizard optioneel
  // geworden als bijwerking.
  assert.equal(
    planAfterOAuth({ next: "/dashboard/facturen", role: null, purpose: null }, row(kaal)).destination,
    "/onboarding",
  );
  // [SEC-REDIRECT] Een vreemde origin blijft geweigerd; de terugval is /dashboard en een vers
  // account gaat dan gewoon de wizard in.
  assert.equal(
    planAfterOAuth({ next: "https://evil.example/invite/accept?token=x", role: null, purpose: null }, row(kaal)).destination,
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
    },
    `${why}: an unreadable profile may be routed and must never be written`,
  );
}

test("[PROFILE-READ] 1 — a finished accountant survives an unreadable read untouched", () => {
  const afgerond: CallbackProfile = { role: "accountant", onboarding_done: true, onboarding_step: 5 };
  // Exactly the production shape of the bug: /login's Google button carries `next` and no ?rol=.
  assertRoutesOnly(
    planAfterOAuth({ next: "/dashboard/accountant", role: null, purpose: null }, UNREADABLE),
    "/dashboard",
    "a completed accountant",
  );
  // And the same account read successfully still goes where it always went — proof that the
  // fixture above is not simply a shape the function never routes anywhere.
  assert.equal(
    planAfterOAuth({ next: "/dashboard/accountant", role: null, purpose: null }, row(afgerond)).destination,
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
  });
  // Half-way through the wizard: the URL may no longer overwrite a choice made inside the app.
  const midden = planAfterOAuth({ ...geen, role: "zzper" }, row(halverwege));
  assert.deepEqual(midden, {
    destination: "/onboarding",
    profileToCreate: null,
    roleUpdate: null,
    markArchief: false,
    backfillName: true,
  });
});

test("[PROFILE-READ] 5 — an invitation destination survives an unreadable read", () => {
  // The one `next` that is honoured on a failed read, because accepting decides nothing about
  // profile state — and because the token expires while we would be guessing.
  const next = "/invite/accept?token=abc-123";
  assertRoutesOnly(planAfterOAuth({ next, role: null, purpose: null }, UNREADABLE), next, "an invited client");
  // Still nothing written, even with a role and an archive purpose riding along with it.
  assertRoutesOnly(
    planAfterOAuth({ next, role: "accountant", purpose: "archief" }, UNREADABLE),
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
    assertRoutesOnly(planAfterOAuth({ next: kwaad, role: null, purpose: null }, UNREADABLE), "/dashboard", kwaad);
  }
});

test("[PROFILE-READ] 7 — the archive path is untouched where the read succeeds", () => {
  // Fresh archive account, both entrances: with the landing carried on ?next= (what /register
  // actually sends) and without it.
  const metBestemming = planAfterOAuth(
    { next: "/dashboard/kluis?doel=archief", role: "zzper", purpose: "archief" },
    row(kaal),
  );
  assert.equal(metBestemming.destination, "/dashboard/kluis?doel=archief");
  assert.equal(metBestemming.markArchief, true);
  assert.equal(planAfterOAuth({ ...geen, purpose: "archief" }, MISSING).markArchief, true);

  // And on a failed read the archive landing is NOT synthesised: that page self-heals
  // onboarding_done + account_purpose off ?doel=archief, so routing an unknown profile there is
  // the markArchief write with one hop in between. Home, where the honest screen is.
  assertRoutesOnly(
    planAfterOAuth({ next: "/dashboard/kluis?doel=archief", role: "zzper", purpose: "archief" }, UNREADABLE),
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

  for (const next of nexts) {
    for (const role of roles) {
      for (const purpose of purposes) {
        const plan = planAfterOAuth({ next, role, purpose }, UNREADABLE);
        const why = `next=${next} role=${role} doel=${purpose}`;
        assert.equal(plan.profileToCreate, null, `${why}: no INSERT/UPSERT`);
        assert.equal(plan.roleUpdate, null, `${why}: no role write — this is the demotion`);
        assert.equal(plan.markArchief, false, `${why}: no onboarding_done / account_purpose write`);
        assert.equal(plan.backfillName, false, `${why}: no full_name overwrite`);
        // [SEC-REDIRECT] And wherever it routes, it is a path on our own origin.
        assert.match(plan.destination, /^\/(?![/\\])/, `${why}: destination stays on our origin`);
      }
    }
  }
});
