// src/lib/surface-audit-gates.test.ts
// [SURFACE-AUDIT] The corrections from the first page-by-page audit (Access Gate + /dashboard),
// pinned so they cannot drift back. Run: npx tsx --test src/lib/surface-audit-gates.test.ts
//
// Source gates, in the shape lifecycle-gates.test.ts established: the pure halves of each fix have
// their own unit tests (profile-read, safe-redirect, klaar-stand, vragen, notification-read,
// navigation); what THIS file holds is the wiring — that the screens still call those halves, in
// the order that makes the fix a fix. tsc and the render suite never see order.
//
// Only full-line comments are stripped before matching (see strip()): every assertion below is on a
// code shape, and a gate that measures its own bounds with a comment measures nothing (AGENTS.md).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// [KLUIS] The plan itself, so the gate below can COMPARE the two registration environments rather
// than restate what one of them is supposed to do. A gate that spells the expected value by hand
// agrees with itself forever; this one asks the code that actually decides.
import { planAfterOAuth, completedStep } from "./auth-landing";

/** Full-line comments out; inline ones stay. Cheap, and blind to `/*` inside an attribute string. */
function strip(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")        // {/* JSX comment */}
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*\n?/gm, "") // a block comment that opens a line
    .replace(/^[ \t]*\/\/.*$/gm, "");           // a line comment that is the whole line
}
const code = (path: string): string => strip(readFileSync(path, "utf8"));

/**
 * The window between two markers, with BOTH bounds proven to exist.
 *
 * [NUMMER-EENMALIG] This exists because the thing AGENTS.md warns about had happened here. Two
 * gates cut handleSubmit out with `page.indexOf("// ─── Derived ───")` as the end — a marker that
 * lives in a COMMENT, which strip() removes. indexOf then answered -1, `slice(i, -1)` ran to the
 * end of the file, and both gates had been measuring handleSubmit PLUS everything after it,
 * including the render tree. They were green, for the wrong reason. A third copy in this batch is
 * what surfaced it.
 *
 * So: cut on real code, and refuse a bound that was not found rather than quietly measuring more.
 */
function between(src: string, from: string, to: string, why: string): string {
  const i = src.indexOf(from);
  const j = src.indexOf(to);
  assert.ok(i >= 0, `${JSON.stringify(from)} is gone — the window cannot start (${why})`);
  assert.ok(j > i, `${JSON.stringify(to)} is gone or moved above the start — the window would run to the end of the file (${why})`);
  return src.slice(i, j);
}

/** `a` must occur, `b` must occur, and `a` must come first. Names the file so a failure reads. */
function inOrder(src: string, a: string, b: string, file: string, why: string): void {
  const ia = src.indexOf(a);
  const ib = src.indexOf(b);
  assert.ok(ia >= 0, `${file}: ${JSON.stringify(a)} is gone — ${why}`);
  assert.ok(ib >= 0, `${file}: ${JSON.stringify(b)} is gone — ${why}`);
  assert.ok(ia < ib, `${file}: ${JSON.stringify(a)} must come before ${JSON.stringify(b)} — ${why}`);
}

// ─── AG-01 [PROFILE-READ] a failed read is not a missing row ──────────────────────────────────
test("[PROFILE-READ] the four readers on the gate keep a failed read apart from a missing row", () => {
  // THREE for its first year, and the fourth is why this line changed. The OAuth callback reads
  // the same table for the same decision and was never converted — and it is the only one of the
  // four that WRITES on "missing", so the confusion cost more there than anywhere else. See the
  // block at the bottom of this test.
  for (const f of [
    "src/middleware.ts",
    "src/app/dashboard/page.tsx",
    "src/app/onboarding/page.tsx",
    "src/app/api/auth/callback/route.ts",
  ]) {
    const src = code(f);
    assert.match(src, /import \{ classifyProfileRead \} from ["']@\/lib\/profile-read["']/,
      `${f} no longer reads the profile through the one classifier`);
  }

  // The middleware decides nothing itself: the classified read goes through the tested gate, and
  // a failed read is never onboarding state and never opens a deeper route (onboarding-gate.ts).
  const mw = code("src/middleware.ts");
  assert.match(mw, /select\("onboarding_done"\)\.eq\("id", user\.id\)\.maybeSingle\(\)/,
    "the middleware's profile read is back to .single(), which reports a missing row as an error");
  assert.doesNotMatch(mw, /if \(profile && !profile\.onboarding_done\)/, "the data-only test is back");
  assert.match(mw, /import \{ onboardingGate \} from "@\/lib\/onboarding-gate"/, "the middleware no longer uses the tested gate");
  assert.match(mw, /const gate = onboardingGate\(\{ read: profileRead, pathname: request\.nextUrl\.pathname \}\)/,
    "the gate is not handed the classified read and the path");
  assert.match(mw, /if \(gate\.action === "redirect"\) \{\s*\n\s*return withRefreshedCookies\(response, NextResponse\.redirect\(new URL\(gate\.to, request\.url\)\)\);/,
    "the gate's redirect is not what the middleware answers with");
  assert.doesNotMatch(mw, /profileRead\.kind === "row" && !profileRead\.row\.onboarding_done/,
    "the middleware forms its own opinion about onboarding again, beside the tested gate");
  assert.doesNotMatch(mw, /new URL\("\/onboarding", request\.url\)/,
    "a hand-written /onboarding redirect is back in the middleware — the gate decides, and a failed read never goes there");

  // The home refuses before it routes: a failed read reaches the error boundary, never the wizard.
  const home = code("src/app/dashboard/page.tsx");
  assert.match(home, /\.eq\('id', user\.id\)\s*\.maybeSingle\(\)/, "the home's profile read is back to .single()");
  assert.doesNotMatch(home, /if \(!profile \|\| !profile\.onboarding_done\) redirect/,
    "a failed read and a missing row are one null again, and both go to the wizard");
  inOrder(home, "profileRead.kind === 'failed'", "redirect('/onboarding')", "src/app/dashboard/page.tsx",
    "the home must rule out a failed read before it sends anyone to the wizard");
  const refuse = home.slice(home.indexOf("profileRead.kind === 'failed'"), home.indexOf("redirect('/onboarding')"));
  assert.match(refuse, /throw new Error\('\[PROFILE-READ\] profile unreadable'\)/,
    "a failed read must reach the error boundary (dashboard/error.tsx), not fall through");
  assert.match(home, /profileRead\.kind === 'missing'\) redirect\('\/onboarding'\)/,
    "a genuinely missing row still goes to the wizard");

  // The wizard creates a row only after a read that SUCCEEDED and found none.
  const wiz = code("src/app/onboarding/page.tsx");
  inOrder(wiz, 'firstRead.kind === "failed"', '.from("profiles").insert(', "src/app/onboarding/page.tsx",
    "the wizard must rule out a failed read before it creates a profile");
  const before = wiz.slice(wiz.indexOf('firstRead.kind === "failed"'), wiz.indexOf('.from("profiles").insert('));
  assert.match(before, /throw new Error\("\[PROFILE-READ\] profile unreadable"\)/,
    "a failed read on the wizard must stop, not insert");
  assert.match(wiz, /if \(!profile\) \{/, "the insert is no longer behind the missing-row test");
  assert.match(wiz, /secondRead\.kind === "failed"/, "the re-read after the insert is trusted blind");
  assert.doesNotMatch(wiz, /const \{ data: fresh \} = await/, "the re-read is back to a data-only destructure");

  // The OAuth callback: the fourth reader, and the one that writes. What the plan decides is held
  // by auth-landing.test.ts; what is held HERE is that the route still asks the question and still
  // does nothing but what the plan says.
  const cb = code("src/app/api/auth/callback/route.ts");
  assert.match(cb, /const profileRead = classifyProfileRead\(/, "the callback no longer classifies its read");
  assert.doesNotMatch(cb, /const \{ data: existingProfile \}/,
    "the data-only destructure is back — a failed read is a missing profile again, and this route UPSERTS on missing");
  assert.match(cb, /\.eq\('id', user\.id\)\s*\.maybeSingle\(\),/,
    "the callback's profile read is back to .single(), where a missing row arrives through the error channel");
  // [EERSTE-DEUR] The window grew from 200 to 900 characters when the intent gained the
  // registration flag and the trade. What it asserts is unchanged — that the CLASSIFIED read is
  // the second argument — and a ceiling that has to be raised as the intent grows is preferable
  // to a `[\s\S]*?` that would match across the whole file and pass for the wrong reason.
  assert.match(cb, /planAfterOAuth\(\s*\{[\s\S]{0,900}?\},\s*profileRead,\s*\)/,
    "the plan is handed something other than the classified read");
  // And the intent it is handed carries all four querystring values, each read raw here and
  // narrowed inside the plan — never parsed in the route.
  for (const [naam, param] of [
    ["destination", /next: searchParams\.get\('next'\)/],
    ["role", /role: searchParams\.get\(ROLE_PARAM\)/],
    ["purpose", /purpose: searchParams\.get\(PURPOSE_PARAM\)/],
    ["registration flag", /register: searchParams\.get\(REGISTER_PARAM\)/],
    ["trade", /vak: searchParams\.get\(VAK_PARAM\)/],
  ] as const) {
    assert.match(cb, param, `the ${naam} no longer reaches the plan, or is parsed in the route`);
  }

  // Every write in the route is plan-driven. The name backfill is the one that used to sit
  // outside the plan, so a plan that ordered nothing still left it standing.
  assert.match(cb, /\} else if \(plan\.backfillName && metaName\) \{/,
    "the full_name backfill is loose from the plan again");
  for (const [write, guard] of [
    ["upsert", /if \(plan\.profileToCreate\) \{/],
    ["role update", /if \(plan\.roleUpdate\) \{/],
    ["markArchief", /if \(plan\.markArchief\) \{/],
    // [EERSTE-DEUR] The two writes this batch added, held to the same rule from the day they
    // arrived: the plan decides, the route only executes. A loose `if (searchParams.get(...))`
    // here would be a write the "this plan orders no write" assertion cannot see.
    // …and the completion additionally waits on the role write landing: completedStep() chooses
    // 5 for an accountant BECAUSE that update is about to make them one, so completing over a
    // failed role would freeze role 'zzper' with an accountant's step and no wizard left to ask.
    ["first-run completion", /if \(plan\.completeFirstRun && roleWritten\) \{/],
    ["trade", /if \(plan\.vakToSet\) \{/],
  ] as const) {
    assert.match(cb, guard, `the ${write} is no longer behind its plan field`);
  }
  // And it says so when it could not look: from the visitor's side a failed read is an ordinary
  // sign-in, so the log is the only place this can ever surface.
  assert.match(cb, /profileRead\.kind === 'failed'[\s\S]{0,400}?console\.error\('\[PROFILE-READ\] profile unreadable in the OAuth callback/,
    "a failed read in the callback passes silently");
});

// ─── [EERSTE-DEUR] A new account enters the product, not a wizard ──────────────────────────────
//
// The behaviour lives in auth-landing.test.ts (what the plan decides) and in
// tests/render/register-door.test.tsx (what the screen asks). What is held HERE is the wiring:
// that /register still SAYS this is a registration, on both of its two exits, and that the
// confirmation-OFF path produces the same account as the callback path instead of quietly
// producing a different one on whichever environment has e-mail confirmation switched off.
test("[EERSTE-DEUR] the registration door says so, on both exits, and completes either way", () => {
  const reg = code("src/app/register/page.tsx");

  // 1. THE INTENT TRAVELS — and through the existing helper family, never a hand-typed string.
  assert.match(reg, /REGISTER_PARAM, REGISTER_FLAG/, "the register flag is spelled out by hand somewhere");
  assert.match(reg, /import \{[^}]*REGISTER_PARAM[^}]*REGISTER_FLAG[^}]*\} from '@\/lib\/register-intent'/,
    "the flag no longer comes from the intent helper family");
  // Both exits: the confirmation mail's callback URL and the Google callback URL.
  const bevestiging = reg.slice(reg.indexOf("function bevestigingsBestemming"), reg.indexOf("function wisFout"));
  assert.ok(bevestiging.length > 100, "bevestigingsBestemming moved — this window measures nothing");
  assert.match(bevestiging, /callback\.searchParams\.set\(REGISTER_PARAM, REGISTER_FLAG\)/,
    "the e-mail confirmation link no longer says it is a registration");
  // [KLUIS] …and the purpose travels with it, exactly as it does on the Google exit. Without it,
  // an archief registration on a database that lacks account_purpose_archief.sql is completed as
  // an ordinary one — stamped with the terminal step of a wizard about sending invoices that this
  // visitor never walked, which the archief branch in auth-landing.ts explicitly refuses to do.
  assert.match(bevestiging, /if \(purpose === 'archief'\) callback\.searchParams\.set\(PURPOSE_PARAM, purpose\)/,
    "the confirmation link drops the archive purpose — the two exits must carry the same intent");
  const google = reg.slice(reg.indexOf("async function handleGoogleRegister"), reg.indexOf("async function handleRegister"));
  assert.ok(google.length > 100, "handleGoogleRegister moved — this window measures nothing");
  assert.match(google, /callback\.searchParams\.set\(REGISTER_PARAM, REGISTER_FLAG\)/,
    "the Google callback no longer says it is a registration");

  // 2. `next` IS NO LONGER FORCED TO THE WIZARD. This is the line that would silently undo the
  // whole batch: /onboarding is a SAFE destination, so a confirmation link carrying it wins over
  // the landing a finished registration should get, and the new user meets the wizard anyway.
  assert.doesNotMatch(bevestiging, /landingPath/,
    "the confirmation link defaults `next` to a landing again — /onboarding would win in the callback");
  assert.match(bevestiging, /const bestemming = gevraagdeBestemming\(\)[\s\S]{0,80}?if \(bestemming\) callback\.searchParams\.set\('next', bestemming\)/,
    "`next` must be set only when the visitor actually brought a destination");

  // 3. [VAK-BRUG] The trade travels on the Google exit — the one place it was provably lost.
  assert.match(google, /if \(vak\) callback\.searchParams\.set\(VAK_PARAM, vak\)/,
    "the trade is dropped on the Google path again");

  // 4. THE DOOR NO LONGER COLLECTS A BUSINESS ADMINISTRATION. The metadata is where this bit:
  // `onboarding_step: 4` existed to skip the wizard screens these fields duplicated, and step 4
  // is the Gmail question — so it skipped step 3 too, the only screen that collects address,
  // IBAN and trade. Three fields at the door cost six behind it.
  for (const weg of ["company_name", "kvk_number", "btw_number", "onboarding_step: 4"]) {
    assert.ok(!reg.includes(weg), `${weg} is back on the registration door`);
  }

  // 5. CONFIRMATION OFF PRODUCES THE SAME ACCOUNT. With e-mail confirmation on, the callback
  // completes the first run; with it off there is a session immediately and the callback is never
  // reached. Without this the same registration would land in the product on one environment and
  // in the wizard on another — a difference nobody sees until a user reports it.
  const upsert = reg.slice(reg.indexOf(".upsert({"), reg.indexOf("{ onConflict: 'id' }"));
  assert.ok(upsert.length > 40, "the confirmation-OFF upsert moved — this window measures nothing");
  assert.match(upsert, /onboarding_done: true/, "a fresh registration is not completed when confirmation is off");
  // The terminal step is asked of the one rule rather than re-spelled — and branches on the
  // purpose, which §7b below compares against what the callback actually decides.
  assert.match(upsert, /onboarding_step: purpose === 'archief'[\s\S]{0,60}?completedStep\(/,
    "…and must ask the ONE rule for the terminal step, not re-spell it");
  assert.match(reg, /import \{ completedStep \} from '@\/lib\/auth-landing'/,
    "the confirmation-OFF path spells the terminal step itself again — two spellings of one rule " +
    "is how the two environments start producing different accounts");
  assert.doesNotMatch(upsert, /company_name|kvk_number|btw_number/, "the removed fields came back through the upsert");

  // 6. AND IT LANDS IN THE PRODUCT. landingPath('boekhouden') is /onboarding — still right for a
  // LEGACY unfinished owner, and wrong for someone who just registered.
  assert.match(reg, /router\.push\(safeRedirect\(gevraagdeBestemming\(\), HOME_PATH\)\)/,
    "the confirmation-OFF path sends a finished registration to a landing again");
  assert.doesNotMatch(reg, /router\.push\(safeRedirect\([^)]*landingPath/,
    "…and never back to landingPath('boekhouden'), which is /onboarding");

  // 7. /login MUST NOT CLAIM TO BE A REGISTRATION. An existing user signing in is not registering,
  // and that difference is the entire reason the parameter exists rather than being inferred.
  const login = code("src/app/login/page.tsx");
  assert.doesNotMatch(login, /REGISTER_PARAM|registratie/,
    "the login screen carries the registration intent — an existing owner would be 'completed' by signing in");

  // 7b. [KLUIS] AND THE TWO ENVIRONMENTS AGREE ABOUT AN ARCHIVE ACCOUNT.
  //
  // `onboarding_done` is true either way — nothing stands between this visitor and their vault.
  // The STEP is where they could drift: the callback keeps an archive account at step 1, because
  // it refuses to stamp someone with the terminal step of an invoice wizard they never walked
  // (auth-landing.ts, the archief branches). The confirmation-OFF write has to say the same thing,
  // or the same registration produces step 1 on production and step 6 on a database where e-mail
  // confirmation happens to be switched off — which is exactly the divergence §5 above exists for,
  // in the one shape it is easiest to miss.
  //
  // The expected values are READ from planAfterOAuth rather than typed here, so the day the
  // callback's answer changes, this gate changes with it instead of quietly disagreeing.
  const archiefIntent = { next: null, role: "zzper", purpose: "archief", register: "1", vak: null };
  const archiefVers = planAfterOAuth(archiefIntent, { kind: "missing" });
  assert.equal(archiefVers.profileToCreate?.onboarding_done, true, "confirmation-ON: an archive account is done");
  assert.equal(archiefVers.profileToCreate?.onboarding_step, 1,
    "confirmation-ON: …and stays at step 1, because no wizard was walked");
  assert.equal(archiefVers.completeFirstRun, null, "confirmation-ON: archive does not borrow the registration completion");

  // The confirmation-OFF write must reach the same two values. Its `onboarding_done` is
  // unconditional (asserted in §5); its step has to branch on the purpose.
  assert.match(upsert, /onboarding_step: purpose === 'archief'\s*\?\s*1\s*:\s*completedStep\(/,
    "confirmation OFF stamps an archive account with the invoice wizard's terminal step, while " +
    "confirmation ON keeps it at step 1 — the same registration, two different accounts");

  // And the non-archive side of that same branch still asks the one rule, for both roles.
  const gewoonVers = planAfterOAuth({ ...archiefIntent, purpose: null }, { kind: "missing" });
  assert.equal(gewoonVers.profileToCreate?.onboarding_step, completedStep("zzper"),
    "confirmation-ON: an ordinary registration carries the terminal step");
  assert.equal(
    planAfterOAuth({ ...archiefIntent, purpose: null, role: "accountant" }, { kind: "missing" })
      .profileToCreate?.onboarding_step,
    completedStep("accountant"),
    "…and an accountant carries the accountant's one",
  );

  // 8. NO NEW SCHEMA. Both writes name columns that already exist; `profiles` Update is generated
  // from the live database, so an invented column is a type error rather than a runtime surprise —
  // tsc is the real gate and this only pins the payloads it checks.
  const cb = code("src/app/api/auth/callback/route.ts");
  assert.match(cb, /\.update\(plan\.completeFirstRun\)/, "the completion writes something other than the planned columns");
  assert.match(cb, /\.update\(\{ vak: plan\.vakToSet \}\)/, "the trade write grew beyond one column");
  // [EERSTE-DEUR] The role write's outcome is read, because the completion leans on it.
  assert.match(cb, /const \{ error: roleError \} = await supabase/,
    "the role write ignores its error again, while the terminal step depends on it having landed");
  // Each scoped to the signed-in owner, like every other write in this route.
  assert.ok((cb.match(/\.eq\('id', user\.id\)/g) ?? []).length >= 4,
    "a write in this route is no longer scoped to the signed-in user");
});


// ─── AG-03 [BESTEMMING] the reset chain keeps the destination ─────────────────────────────────
test("[BESTEMMING] the password-reset chain carries the safe destination from login back to login", () => {
  const login = code("src/app/login/page.tsx");
  assert.match(login, /import \{ isSafeRedirect, safeRedirect, withRedirect \} from '@\/lib\/safe-redirect'/);
  assert.match(login, /href=\{withRedirect\('\/wachtwoord-vergeten', gewenst\)\}/,
    "the 'Wachtwoord vergeten?' link dropped the destination again");
  assert.doesNotMatch(login, /href="\/wachtwoord-vergeten"/, "the bare anchor is back");

  const vergeten = code("src/app/wachtwoord-vergeten/page.tsx");
  assert.match(vergeten, /const gewenst = searchParams\.get\('redirect'\)/, "step 1 does not read the destination");
  assert.match(vergeten, /redirectTo: new URL\(withRedirect\('\/wachtwoord-herstellen', gewenst\), window\.location\.origin\)\.toString\(\)/,
    "the reset mail's link no longer carries the destination to step 2");
  assert.match(vergeten, /const loginHref = withRedirect\('\/login', gewenst\)/);
  assert.doesNotMatch(vergeten, /href="\/login"/, "a bare /login link is back on step 1");

  const herstellen = code("src/app/wachtwoord-herstellen/page.tsx");
  assert.match(herstellen, /const gewenst = searchParams\.get\('redirect'\)/, "step 2 does not read the destination");
  assert.match(herstellen, /const loginHref = withRedirect\('\/login', gewenst\)/);
  assert.match(herstellen, /href=\{withRedirect\('\/wachtwoord-vergeten', gewenst\)\}/, "a new link from a spent one loses the destination");
  assert.match(herstellen, /href=\{withRedirect\('\/verificatie', withRedirect\('\/wachtwoord-herstellen', gewenst\)\)\}/,
    "the second step no longer comes back to a reset screen that knows the destination");
  assert.doesNotMatch(herstellen, /href="\/login"/, "a bare /login link is back on step 2");
  assert.doesNotMatch(herstellen, /href="\/wachtwoord-vergeten"/, "a bare /wachtwoord-vergeten link is back on step 2");
  assert.doesNotMatch(herstellen, /href="\/verificatie\?redirect=%2Fwachtwoord-herstellen"/, "the fixed second-step link is back");

  // [SEC-REDIRECT] Nothing in the chain reads the parameter without the one check.
  for (const [f, src] of [["step 1", vergeten], ["step 2", herstellen]] as const) {
    assert.doesNotMatch(src, /decodeURIComponent\(/, `${f} decodes a destination by hand`);
    assert.doesNotMatch(src, /router\.push\(gewenst|href=\{gewenst\}/, `${f} navigates to an unchecked destination`);
  }
});

// ─── HOME-01 [KLAAR-KWARTAAL] one quarter for the verdict and the door ────────────────────────
test("[KLAAR-KWARTAAL] the home's verdict and the readiness page name the same quarter", () => {
  const home = code("src/app/dashboard/zzp/ZzpDashboard.tsx");
  assert.match(home, /import \{ lastCompletedQuarter, type YearQuarter \} from '@\/lib\/quarter'/,
    "the home no longer takes its quarter from the shared source");
  assert.doesNotMatch(home, /\.getMonth\(\)|\.getFullYear\(\)/,
    "the home derives a quarter from the device clock again — quarter.ts says why that is wrong");
  assert.match(home, /const period = lastCompletedQuarter\(\)\s*\n\s*setKlaarPeriod\(period\)/,
    "the period must be decided once, before the fetch, and kept for the door");
  assert.match(home, /fetch\(`\/api\/readiness\?year=\$\{period\.year\}&quarter=\$\{period\.quarter\}`\)/,
    "the readiness fetch does not use the decided period");
  assert.match(home, /router\.push\(klaarPath\(klaarPeriod \?\? lastCompletedQuarter\(\)\)\)/,
    "the door no longer carries the period the verdict was measured for");
  assert.doesNotMatch(home, /router\.push\('\/dashboard\/klaar'\)/, "the bare door is back");

  const page = code("src/app/dashboard/klaar/KlaarClient.tsx");
  // [KLAAR-TOEKOMST] The same import now also carries the started-period rule and the current quarter.
  assert.match(page, /import \{ quarterFromParams, currentQuarter, isPeriodStarted, type QuarterNo as PeriodQuarter \} from '@\/lib\/quarter'/);
  assert.match(page, /const init = quarterFromParams\(\(k\) => searchParams\.get\(k\)\)/,
    "the readiness page ignores the period in its URL, so the door and the page can drift again");
  assert.doesNotMatch(page, /lastCompletedQuarter\(\)/,
    "the page decides its own default beside the one quarterFromParams already falls back to");
});

// ─── HOME-02 [VRAGEN-TELLING] both kinds of question, and an honest unknown ───────────────────
test("[VRAGEN-TELLING] the home counts document AND invoice questions, as two reads, and never a false zero", () => {
  const home = code("src/app/dashboard/zzp/ZzpDashboard.tsx");
  assert.match(home, /\.eq\('subject_type', 'document'\)\.eq\('status', VRAAG_STATUS\)/, "the document count is gone");
  assert.match(home, /\.eq\('subject_type', 'invoice'\)\.eq\('status', VRAAG_STATUS\)/, "the invoice count is gone");
  // Two policies, two reads — never one query that needs both (see the questions page).
  assert.doesNotMatch(home, /\.or\(|\.in\('subject_type'/, "the two kinds are read in one query, which fails whole where the second policy is not rolled out");
  assert.match(home, /openQuestionCount\(\s*\{ count: documentVragen, error: documentVragenErr \},\s*\{ count: invoiceVragen, error: invoiceVragenErr \},?\s*\)/,
    "the two counts must go through the one pure function, error bindings included");
  assert.doesNotMatch(home, /setVragenCount\(vragenErr \? 0 :/, "a failed count is a zero again");
  assert.match(home, /vragenStand\?\.known === false/, "the unknown state is no longer rendered");
  assert.match(home, /t\('start\.vragen\.onbekend'\)/, "the home hides a failed count instead of saying it");
  assert.match(home, /t\(vragenRegel\.key, vragenRegel\.params\)/, "the banner hard-codes a sentence again");

  const lib = code("src/lib/vragen.ts");
  assert.doesNotMatch(lib, /Je boekhouder heeft/, "the banner's Dutch is back inside the pure module");
  assert.match(lib, /if \(documents\.error \|\| invoices\.error\) return \{ known: false \}/,
    "a failed half must make the whole answer unknown");
});

// ─── HOME-03 [MELDING-WAARHEID] the bell claims nothing the store did not confirm ─────────────
test("[MELDING-WAARHEID] the bell rolls back on failed persistence, and every mark-all-read reports its outcome", () => {
  const bel = code("src/app/dashboard/_shared/index.tsx");
  assert.match(bel, /import \{ markedRead, rolledBack, isUnread, unreadIds, type ReadOverride \} from '@\/lib\/notification-read'/);
  assert.match(bel, /onMarkAllRead\?: \(\) => Promise<boolean>/, "the bell no longer asks its caller for the outcome");
  assert.doesNotMatch(bel, /onMarkAllRead\?: \(\) => void/);

  // The single row: the PATCH is read, and anything but ok takes the local mark back.
  const row = bel.slice(bel.indexOf("async function markAsRead"), bel.indexOf("async function markAllReadLocally"));
  assert.ok(row.length > 50, "markAsRead moved — this gate is measuring nothing");
  assert.match(row, /stored = res\.ok/, "the PATCH's answer goes unread again");
  assert.match(row, /if \(!stored\) \{\s*\n\s*setReadOverride\(prev => rolledBack\(prev, \[id\]\)\)/,
    "a failed PATCH no longer takes the local mark back");
  assert.match(row, /showToast\(t\('kop\.gelezenMislukt'\)/, "a failed PATCH is silent again");

  // Mark all: marked, awaited, rolled back on a false — exactly the ids that were marked.
  const allStart = bel.indexOf("async function markAllReadLocally");
  const all = bel.slice(allStart, bel.indexOf("return (", allStart));
  assert.ok(allStart >= 0 && all.length > 50, "markAllReadLocally moved — this gate is measuring nothing");
  assert.match(all, /const ids = unreadIds\(notifications, readOverride\)/);
  assert.match(all, /setReadOverride\(prev => markedRead\(prev, ids\)\)/);
  assert.match(all, /stored = await onMarkAllRead\(\)/, "the caller's outcome is not awaited");
  assert.match(all, /if \(!stored\) \{\s*\n\s*setReadOverride\(prev => rolledBack\(prev, ids\)\)/,
    "a false from the caller no longer takes the marks back");
  assert.match(bel, /onClick=\{\(\) => void markAllReadLocally\(\)\}/, "the button bypasses the rollback path");
  assert.doesNotMatch(bel, /notifications\.forEach\(n => \{ next\[n\.id\] = true \}\)/, "the fire-and-forget clear is back");

  // Every caller answers with a boolean that means "stored".
  for (const f of [
    "src/app/dashboard/zzp/ZzpDashboard.tsx",
    "src/components/nav/RailAccount.tsx",
    "src/modules/accountant/pages/AccountantHome.tsx",
    "src/components/nav/MedewerkerHeader.tsx",
  ]) {
    const src = code(f);
    const at = src.indexOf("async function markAllRead(): Promise<boolean>");
    assert.ok(at >= 0, `${f}: markAllRead no longer promises its outcome`);
    const fn = src.slice(at, src.indexOf("\n  }\n", at));
    assert.match(fn, /return false/, `${f}: a failed update does not answer false`);
    assert.match(fn, /return true/, `${f}: a stored update does not answer true`);
    inOrder(fn, "return false", "setNotifications(", f, "false must be answered BEFORE the rows are shown as read");
  }
});

// ─── HOME-05 [FROM-HOME] the way back is written into the link ────────────────────────────────
test("[FROM-HOME] the attention rows and the Team card tell their screens they came from the home", () => {
  const truth = code("src/app/dashboard/zzp/DailyTruth.tsx");
  assert.match(truth, /import \{ attentionHref \} from '@\/lib\/home-links'/);
  assert.match(truth, /const openItem = \(it: AttentionItem\) => router\.push\(attentionHref\(it\)\)/,
    "the attention rows build their own link again — without the marker");
  assert.doesNotMatch(truth, /manage\?focus=\$\{it\.id\}`/, "the unmarked manage link is back");

  const home = code("src/app/dashboard/zzp/ZzpDashboard.tsx");
  assert.match(home, /router\.push\('\/dashboard\/settings\/team\?from=home'\)/, "the Team card lost its marker");
  assert.doesNotMatch(home, /router\.push\('\/dashboard\/settings\/team'\)/);

  const nav = code("src/lib/navigation.ts");
  const teamRule = nav.slice(nav.indexOf("match: /^\\/dashboard\\/settings\\/team$/"), nav.indexOf("match: /^\\/dashboard\\/bank\\/categoriseren$/"));
  assert.ok(teamRule.length > 20, "the team rule moved — this gate is measuring nothing");
  assert.match(teamRule, /search\?\.get\('from'\) === 'home' \? getHomePath\(role\) : '\/dashboard\/settings'/,
    "the team rule no longer reads the marker, so Terug from the home tile lands on Instellingen");
});

// ─── HOME-07 / HOME-06 [GROET] the greeting speaks, and speaks the owner's language ───────────
test("[GROET] the greeting never shows an emoji alone, and holds no Dutch of its own", () => {
  const home = code("src/app/dashboard/zzp/ZzpDashboard.tsx");
  assert.doesNotMatch(home, />GOEDENDAG</, "the shouted Dutch label is back");
  assert.match(home, /\{t\('start\.goedendag'\)\}/);
  assert.doesNotMatch(home, /\?\? 'daar'/, "an empty name is an emoji alone again: '' is not nullish");
  assert.match(home, /const firstName = profile\.full_name\?\.trim\(\)\.split\(\/\\s\+\/\)\[0\] \|\| t\('bh\.home\.groet\.daar'\)/,
    "the greeting's fallback must be the catalogue's word, reached through || so an empty name takes it");

  const shell = code("src/app/dashboard/_shared/index.tsx");
  assert.doesNotMatch(shell, /label: 'Vandaag'|label: 'Klanten'/, "a header link holds its own Dutch again");
  assert.match(shell, /label: t\('chrome\.vandaag'\)/);
  assert.match(shell, /label: t\('nav\.clients'\)/);

  const tools = code("src/components/tools/DashboardTools.tsx");
  assert.match(tools, /label: MessageKey;/, "the tools block holds sentences instead of keys again");
  assert.match(tools, /const t = translator\(useLocale\(\)\)/);
});

// ─── HOME-08 [UITLOGGEN] a refused sign-out stays signed in and says so ───────────────────────
test("[UITLOGGEN] no way out navigates to /login as though signOut() succeeded", () => {
  for (const f of [
    "src/app/dashboard/zzp/ZzpDashboard.tsx",
    "src/components/nav/RailAccount.tsx",
    "src/modules/accountant/pages/AccountantHome.tsx",
    "src/components/nav/MedewerkerHeader.tsx",
  ]) {
    const src = code(f);
    assert.doesNotMatch(src, /await [\w().]*auth\.signOut\(\)\s*;?\s*\n?\s*router\.push\('\/login'\)/,
      `${f}: signs out blind and navigates as if it worked`);
    assert.match(src, /const \{ error \} = await [\w().]*auth\.signOut\(\)/, `${f}: the sign-out's outcome goes unread`);
    assert.match(src, /t\('kop\.uitloggenMislukt'\)/, `${f}: a refused sign-out is silent`);
  }
});

// ─── AG-02 [TAAL-POORT] the two password screens and the tools block are under the sweep ─────
test("[TAAL-POORT] the reset screens and the tools block are on the translation gate's list", () => {
  const gate = readFileSync("src/lib/lifecycle-gates.test.ts", "utf8");
  const at = gate.indexOf('test("[TAAL] the translated screens have no Dutch of their own left"');
  assert.ok(at > 0, "the translation gate moved");
  const list = gate.slice(at, gate.indexOf("const leftovers: string[] = [];", at));
  for (const f of ["src/app/wachtwoord-vergeten/page.tsx", "src/app/wachtwoord-herstellen/page.tsx", "src/components/tools/DashboardTools.tsx"]) {
    assert.ok(list.includes(`"${f}"`), `${f} fell off the translation gate's list`);
  }
  // …and the gate sees an all-caps text node now, which is how GOEDENDAG hid for a year.
  assert.match(gate, /\/> \*\(\[A-ZÉ\]\{5,\}\(\?: \[A-ZÉ\]\{2,\}\)\*\) \*<\/g,/, "the all-caps pattern is gone from the sweep");
  const register = code("src/app/register/page.tsx");
  assert.doesNotMatch(register, />Laden\.\.\.</, "the register fallback shouts Dutch again");
});

// ═══ Phase 2 (vragen · berichten · klaar) — the corrections, pinned ══════════════════════════════

// ─── VR-02 [VRAAG-EIGENAAR] every question is answered to its asker; links are a collection ───
test("[VRAAG-EIGENAAR] the questions screen carries each question's accountant and never reads 'the' accountant as one row", () => {
  const page = code("src/app/dashboard/vragen/page.tsx");
  assert.match(page, /\.select\('accountant_id, subject_id, status, vraag_text, updated_at'\)\s*\n\s*\.eq\('subject_type', 'document'\)/,
    "the document questions no longer carry their asker");
  assert.match(page, /\.select\('accountant_id, subject_id, status, vraag_text, updated_at'\)\s*\n\s*\.eq\('subject_type', 'invoice'\)/,
    "the invoice questions no longer carry their asker");
  assert.match(page, /from\('accountant_clients'\)\.select\('accountant_id'\)\.eq\('zzper_id', user\.id\),/,
    "the links must be read as a collection");
  assert.doesNotMatch(page, /accountant_clients'\)[^\n]*\.maybeSingle\(\)/, "the singular link read is back — an owner with two offices then has 'no accountant'");
  assert.doesNotMatch(page, /accountant_clients'\)[^\n]*\.limit\(1\)/, "a link picked at random is not the accountant who asked");
  assert.match(page, /classifyAccountantLinks\(\{ data: linkRead\.data, error: linkRead\.error \}\)/, "the read must go through the one classifier (failed / zero / one / many)");
  assert.match(page, /provenAccountantIds\(/, "names may only be fetched for ids the owner's rows or links prove");
  assert.match(page, /links=\{links\}/, "the collection no longer reaches the screen");
  assert.doesNotMatch(page, /accountantId=\{accountantId\}/, "the screen is handed one accountant again");

  const client = code("src/app/dashboard/vragen/VragenClient.tsx");
  assert.match(client, /const target = answerTargetFor\(vraag\.accountantId, links\)/, "the answer's receiver must be decided from the question's own asker");
  assert.match(client, /receiver_id: target\.accountantId/, "the answer is posted to someone other than the asker");
  assert.doesNotMatch(client, /receiver_id: accountantId/, "the answer goes to 'the' accountant again");
  assert.match(client, /t\('vr\.nietMeerGekoppeld'\)/, "a question whose asker is no longer linked must say so");
  assert.match(client, /t\('vr\.koppelingOnbekend'\)/, "a failed link read must be said, not guessed either way");
  assert.match(client, /key=\{`\$\{v\.accountantId \?\? 'niemand'\}:\$\{v\.documentId\}`\}/, "two offices asking about one invoice must be two cards");

  // The home and the rail: the same collection, the same door.
  for (const f of ["src/app/dashboard/zzp/ZzpDashboard.tsx", "src/components/nav/RailAccount.tsx"]) {
    const src = code(f);
    assert.doesNotMatch(src, /accountant_clients'\)[^\n]*\.maybeSingle\(\)/, `${f}: the singular link read is back`);
    assert.doesNotMatch(src, /accountant_clients'\)[^\n]*\.limit\(1\)/, `${f}: a link picked at random`);
    assert.match(src, /messagesDoorHref\(classifyAccountantLinks\(\{ data: linkRead\.data, error: linkRead\.error \}\)\)/,
      `${f}: the Berichten door must be decided from the collection`);
  }
  const lib = code("src/lib/accountant-links.ts");
  assert.match(lib, /if \(read\.error\) return \{ state: "failed" \}/, "a failed read must stay apart from zero links");
  assert.match(lib, /links\.ids\.length === 1/, "only exactly one link opens a thread directly");
});

// ─── VR-03 [VRAAG-DEUR] an invoice question opens the screen that shows THAT invoice ──────────
test("[VRAAG-DEUR] the card's door is decided from the invoice's direction on the server, and Terug returns to the questions", () => {
  const page = code("src/app/dashboard/vragen/page.tsx");
  assert.match(page, /select\('id, invoice_number, client_name, total_inc_btw, invoice_date, direction, sender_id, receiver_id'\)/,
    "the invoice read no longer carries the direction and the ownership");
  assert.match(page, /invoiceHref: v\.subjectType === 'invoice' && !v\.documentMissing \? invoiceQuestionHref\(v\.invoice, user\.id\) : null/,
    "the door must be decided by invoiceQuestionHref, with the owner's id");
  const client = code("src/app/dashboard/vragen/VragenClient.tsx");
  assert.match(client, /const factuurHref = vraag\.invoiceHref \?\? null/, "the card must use the door the server decided");
  assert.doesNotMatch(client, /manage\?focus=\$\{encodeURIComponent\(vraag\.documentId\)\}/, "every invoice question is sent to the purchase screen again");
  const lib = code("src/lib/vragen.ts");
  assert.match(lib, /inv\.direction === 'incoming' \|\| inv\.direction === 'outgoing'/, "the direction column decides first");
  assert.match(lib, /inv\.receiver_id === ownerId/, "…and ownership settles a null direction, as the closing package does");
  assert.match(lib, /if \(direction === null\) return null/, "an undecidable direction gets no door — never a guess");
  const nav = code("src/lib/navigation.ts");
  assert.equal((nav.match(/if \(from === 'vragen'\) return '\/dashboard\/vragen'/g) ?? []).length, 2,
    "both invoice screens must know the way back to the questions");
});

// ─── TH-01 [GESPREK-GRENS] a thread with a stranger is not a conversation ─────────────────────
test("[GESPREK-GRENS] the thread reports whether the pair is linked, and the screen draws no composer for a stranger", () => {
  const route = code("src/app/api/messages/route.ts");
  assert.match(route, /const linked = await pairIsLinked\(supabase, user\.id, otherId\)/, "the route no longer establishes the link as a fact of its own");
  assert.match(route, /linked,\s*\n\s*\}\)/, "the link fact does not reach the screen");
  assert.match(route, /if \(error\) \{[\s\S]{0,200}?return null/, "a failed link read must be null, never false");
  const page = code("src/app/dashboard/messages/[id]/page.tsx");
  assert.match(page, /const kanSturen = linked !== false/, "the composer must follow the server's answer");
  assert.match(page, /const vreemde = linked === false && messages\.length === 0/, "a stranger's empty thread must be its own state");
  assert.match(page, /\{kanSturen \? \(/, "the composer is drawn regardless of the link");
  assert.match(page, /t\('gesprek\.nietGekoppeld'\)/);
  assert.match(page, /t\('gesprek\.koppelingWeg'\)/);
  inOrder(page, "vreemde ? (", "messages.length === 0 ? (", "src/app/dashboard/messages/[id]/page.tsx", "the stranger state must win over the 'say hello' state");
});

// ─── MS-01 / MS-02 [AG-03] [TAAL] the inbox keeps its destination and its language ────────────
test("[AG-03] a session that expires on the message screens comes back to them; [TAAL] the inbox dates the owner's language", () => {
  const lijst = code("src/app/dashboard/messages/page.tsx");
  assert.match(lijst, /router\.push\(withRedirect\('\/login', '\/dashboard\/messages'\)\)/, "the inbox sends an expired session to a bare /login again");
  assert.match(lijst, /toLocaleDateString\(LOCALE_META\[locale\]\.intl\)/, "the inbox dates in nl-NL whatever the owner's language");
  assert.doesNotMatch(lijst, /toLocaleDateString\('nl-NL'\)/);
  const draad = code("src/app/dashboard/messages/[id]/page.tsx");
  assert.match(draad, /router\.push\(withRedirect\('\/login', `\/dashboard\/messages\/\$\{otherId\}`\)\)/, "the thread sends an expired session to a bare /login again");
});

// ─── KL-01 [READINESS-DEGRADE] availability may degrade, financial truth may not ──────────────
test("[READINESS-DEGRADE] the readiness route classifies every fail-soft read, and the verdict is never green over an unread input", () => {
  const route = code("src/app/api/readiness/route.ts");
  assert.match(route, /export async function readinessResponse\(req: NextRequest, deps: ReadinessDeps\)/, "the route must take its clients injected, or no test can fail a read on its own");
  assert.match(route, /return NextResponse\.json\(\{ error: "readiness_unavailable", detail: message \}, \{ status: 503 \}\)/, "an essential failure must be a 503, never a verdict");
  assert.match(route, /const unverified: UnverifiedRead\[\] = \[\];/, "the unread inputs are no longer collected");
  assert.match(route, /unverified, \/\/ \[READINESS-DEGRADE\]/, "…or no longer handed to the verdict");
  // Every class B site says so; every class C site is a recognised schema absence, never a bare catch.
  for (const key of ["dateless_invoices", "amount_only_bookings", "bank_continuity", "bank_coverage", "vat_exemption", "rate_split", "excluded_bank_lines", "card_triangle", "regime_lines", "bad_debt", "vat_clawback"]) {
    assert.match(route, new RegExp(`unread\\("${key}"`), `the ${key} read fell back to its zero again`);
  }
  assert.doesNotMatch(route, /\} catch \{\s*\n\s*\/\*/, "a bare catch with a comment is a read that falls to its zero");
  assert.doesNotMatch(route, /\.catch\(\(\) => \[\]\)/, "a swallowed read on the verdict path");
  assert.doesNotMatch(route, /const \{ data: korProfile \} = await/, "the KOR flag is read without its error again — a failed read is not 'KOR off'");
  assert.match(route, /if \(korErr\) \{\s*\n\s*throw/, "a failed KOR read must throw (essential) — an absent column included: it does not prove KOR is off");
  assert.doesNotMatch(route, /schemaAbsent\(korErr/, "the KOR read grew a class-C exception again");
  assert.doesNotMatch(route, /if \(!schemaAbsent\(e\)\) unread\("bank_(continuity|coverage)"/, "an absent evidence table is read as 'no gaps' again — that is class B");
  assert.match(route, /function schemaAbsent\(e: unknown, column: "auto_match_reason" \| "ignore_reason"\)/, "class C must stay limited to the two columns whose absence proves non-applicability");
  assert.match(route, /if \(periodsErr\) throw periodsErr;/, "the continuity read's error value is thrown away again");
  assert.match(route, /if \(overlapErr\) throw overlapErr;/, "the coverage read's error value is thrown away again");
  assert.match(route, /readExcludedBankIdsChecked\(/, "the excluded-lines read no longer says whether it happened");
  assert.match(route, /collectRegimeFlagsChecked\(/, "the regime read no longer says whether it happened");

  const model = code("src/lib/readiness.ts");
  assert.match(model, /title: "Niet alles kon worden gecontroleerd"/, "an unread input is no longer named as a gap");
  assert.match(model, /verified: unverifiedReads\.length === 0/, "the report no longer says whether it was fully read");
  inOrder(model, 'title: "Niet alles kon worden gecontroleerd"', 'if (hasData && missing.length === 0 && score >= 90) status = "ready"', "src/lib/readiness.ts", "the gap must exist BEFORE the status is decided, so 'ready' cannot be reached over it");

  // The screens: the page names what was not read; the home never shows green for it.
  const page = code("src/app/dashboard/klaar/KlaarClient.tsx");
  assert.match(page, /report\.verified === false && \(/, "the readiness page no longer shows the incomplete state");
  assert.match(page, /t\('klr\.onvolledig\.kop'\)/);
  assert.match(page, /t\('klr\.onvolledig\.nietGelezen', \{ onderdelen:/, "…or no longer names what was not read");
  const stand = code("src/lib/klaar-stand.ts");
  inOrder(stand, 'if (report?.verified === false) {', 'if (status === "ready") {', "src/lib/klaar-stand.ts", "'incomplete' must be decided before 'ready', so a stale ready can never render green");

  // The summary carries what it could not check, as numbers, not only as prose.
  const summary = code("src/lib/closing-package.ts");
  assert.match(summary, /evidenceUnknown,\s*\n\s*datelessChecked: datelessRead\.checked,/, "the closing summary no longer reports its unread evidence and dateless check");
});

// ─── KL-02 [KLAAR-TOEKOMST] · KL-03 [KLAAR-URL] the period: not in the future, and in the URL ───
test("[KLAAR-TOEKOMST] a period that has not begun gets no verdict, on one Amsterdam rule for the route, the page and the picker", () => {
  const route = code("src/app/api/readiness/route.ts");
  assert.match(route, /if \(!isPeriodStarted\(\{ year, quarter \}\)\) \{\s*\n\s*return NextResponse\.json\(\{ error: "period_not_started", year, quarter \}, \{ status: 400 \}\)/,
    "the route answers a future period with a verdict again");
  inOrder(route, 'if (!isPeriodStarted({ year, quarter }))', 'const owner = await resolveQuarterOwner(', "src/app/api/readiness/route.ts", "the period is refused before anything is read");
  const page = code("src/app/dashboard/klaar/KlaarClient.tsx");
  assert.match(page, /const begonnen = isPeriodStarted\(\{ year, quarter: quarter as PeriodQuarter \}\)/, "the page no longer asks the shared rule");
  assert.match(page, /if \(!begonnen\) \{ setLoading\(false\); return \}/, "the page fetches a verdict for a period that has not begun");
  assert.match(page, /t\('klr\.periode\.nietBegonnen'\)/, "the non-verdict state is gone");
  assert.match(page, /const nu = currentQuarter\(\)/, "the picker's 'current quarter' is no longer the shared Amsterdam one");
  assert.doesNotMatch(page, /Math\.floor\(\(Number\(todayNl\.slice\(5, 7\)\) - 1\) \/ 3\) \+ 1/, "the picker derives its own current quarter beside quarter.ts again");
  const lib = code("src/lib/quarter.ts");
  assert.match(lib, /export function isPeriodStarted\(period: YearQuarter, now: Date = new Date\(\)\): boolean \{\s*\n\s*const cur = amsterdamYearQuarter\(now\);/, "the rule must be decided on the Amsterdam day, like the rest of the file");
});

test("[KLAAR-URL] the readiness page keeps its period in the URL and nowhere else", () => {
  const page = code("src/app/dashboard/klaar/KlaarClient.tsx");
  assert.match(page, /const init = quarterFromParams\(\(k\) => searchParams\.get\(k\)\)\s*\n\s*const year = init\.year/, "the period must be read from the URL on every render");
  assert.match(page, /const quarter: number = init\.quarter/);
  assert.doesNotMatch(page, /useState\(init\.year\)|useState<number>\(init\.quarter\)|setYear\(|setQuarter\(/, "a second copy of the period lives in state again — the URL and the screen can drift");
  assert.match(page, /const gaNaar = \(y: number, q: number\) => router\.push\(klaarPath\(\{ year: y, quarter: q as PeriodQuarter \}\), \{ scroll: false \}\)/,
    "the picker must navigate to the canonical path (klaarPath), so refresh, copy, back/forward and a deep link all name the same period");
  assert.match(page, /onClick=\{\(\) => !future && gaNaar\(year, q\)\}/, "a quarter button no longer navigates");
  assert.match(page, /gaNaar\(Math\.max\(2000, year - 1\), quarter\)/, "the year-back button no longer navigates");
  assert.doesNotMatch(page, /window\.history|history\.pushState|history\.replaceState/, "browser history is not business state");
});

// ─── [VERKOPER-COMPLEET] The wiring of the send-time seller completion ────────────────────────
//
// The DECISIONS all live in seller-completeness.ts and every branch of them is executed in
// seller-completeness.test.ts. What no unit test can see is the ORDER those decisions run in, and
// order is the whole safety of this batch: a legal invoice number is forward-only (art. 35 Wet OB),
// so "ask, then save, then send, then number" is a different product from "number, then ask".
//
// tsc does not model when a call happens, eslint does not read call order, and the render suite
// never presses a button. So these four facts are held here, and each is cut on real code with
// inOrder(), which fails loudly when a marker has moved rather than quietly measuring to the end
// of the file.

test("[VERKOPER-COMPLEET] the send door still refuses an incomplete seller, before it mints a number", () => {
  const route = code("src/app/api/invoice/send/route.ts");

  // 1 — the refusal is still there, and still a refusal. This batch made the SCREEN ask nicely;
  // it must not have made the DOOR ask nicely. A request that arrives without the screen — a
  // script, a retry, an old tab — is refused exactly as it always was.
  assert.match(route, /missing_seller_fields: missingSeller/, "the send door stopped naming the missing seller fields");
  assert.match(route, /status: 400/, "the seller refusal is no longer a refusal");
  assert.match(
    route,
    /Vul eerst je \$\{missingSeller\.join\(', '\)\} in bij Instellingen — wettelijk verplicht op een factuur \(Art\. 35a Wet OB 1968\)\./,
    "the refusal sentence changed — it is live text an owner reads",
  );

  // 2 — ONE definition. The four inline checks that used to stand here are gone: while they
  // existed, the screen and the door could disagree about what "complete" means, and the day they
  // do is the day a first invoice cannot be sent and nothing can say why.
  assert.match(route, /missingSellerFields\(sellerProfile as SellerFacts \| null\)/, "the door derives completeness some other way again");
  assert.doesNotMatch(route, /missingSeller\.push\(/, "the door grew its own copy of the rule beside the shared module");

  // 3 — and it happens BEFORE the number. This is the invariant of §9: a refused completion must
  // never leave a gap in the sequence. `generateInvoiceNumber` is the only thing in this route
  // that draws from the counter.
  inOrder(route, "missingSellerFields(", "const generated = await generateInvoiceNumber(",
    "send/route.ts", "a seller check after the number is minted burns a sequence number on every incomplete profile");

  // …and still before the KOR and verlegd checks, which read the very profile row this reads.
  inOrder(route, "missingSellerFields(", "const korCheck = checkKorInvoice(",
    "send/route.ts", "the seller check must stay the first thing done with the seller's profile");
});

test("[VERKOPER-COMPLEET] the send door tells a failed profile read apart from an empty profile", () => {
  const route = code("src/app/api/invoice/send/route.ts");

  // [PROFILE-READ] The bug this closes: `const { data: sellerProfile }` made supabase-js's one
  // failure shape — { data: null, error } — arrive as a profile with nothing in it, and the owner
  // was then told to go and fill in a BTW-nummer that has been on file for a year.
  assert.match(route, /const sellerRead = classifyProfileRead\(/, "the seller profile is read without being classified again");
  assert.match(route, /if \(sellerRead\.kind === 'failed'\)/, "a failed seller read is no longer handled at all");
  assert.match(route, /code: 'profiel_onleesbaar'/, "the unreadable answer lost the code the screen keys on");
  assert.match(route, /status: 503/, "an unreadable profile is being reported as something other than a temporary failure");
  assert.match(route, /const sellerProfile = sellerRead\.kind === 'row' \? sellerRead\.row : null/,
    "the classified read is being flattened back into a nullable row some other way");

  // Refusing on a failed read must happen BEFORE the completeness question, or the false
  // "your details are missing" is produced anyway and the 503 never runs.
  inOrder(route, "sellerRead.kind === 'failed'", "missingSellerFields(",
    "send/route.ts", "an unreadable profile would be reported as four missing fields");
  // And before the number, like everything else in this block.
  inOrder(route, "sellerRead.kind === 'failed'", "const generated = await generateInvoiceNumber(",
    "send/route.ts", "a database hiccup would consume an invoice number");
});

test("[VERKOPER-COMPLEET] the screen asks before it creates anything, and never after", () => {
  const page = code("src/app/dashboard/invoice/new/page.tsx");

  // The gate is the LAST thing before the irreversible half of handleSubmit. Everything above it
  // is a form the owner can still change; below it a draft row is written and the send door is
  // asked for a legal number.
  assert.match(page, /const poort = await verkoperPoort\(\)/, "the send no longer passes the seller gate");
  assert.match(page, /if \(poort === 'stop'\) return/, "the gate's verdict is ignored — a stop would fall through into the send");
  inOrder(page, "const poort = await verkoperPoort()", "await fetch('/api/invoice/draft'",
    "invoice/new/page.tsx", "the draft is created before the owner is asked, so a stop leaves a rejected concept behind");
  inOrder(page, "const poort = await verkoperPoort()", "await fetch('/api/invoice/send'",
    "invoice/new/page.tsx", "the send door is called before the owner is asked — the 400 comes back and the completion is pointless");

  // Only on the irreversible button. Saving a CONCEPT with an empty profile must stay possible —
  // nothing leaves the building — and an OFFERTE goes through send-offerte, which mints no number
  // and which art. 35a therefore says nothing about.
  assert.match(page, /if \(mode === 'sent' && invoiceType !== 'offerte'\) \{\s*\n\s*setLoading\(true\)\s*\n\s*const poort = await verkoperPoort\(\)/,
    "the gate now runs on a draft save or on an offerte, which asks a legal question of a document that is not a legal invoice");

  // The decision itself is not re-derived on the screen: the shipped classifiers are called, and
  // it is their answer that opens the panel. A hand-rolled `json.status === …` here is how the
  // screen starts asking for a field the door does not want.
  assert.match(page, /const poort = classifySellerGate\(res\.status, json\)/, "the screen judges the gate answer by itself again");
  assert.match(page, /if \(!saveAllowsSend\(uitkomst\)\)/, "the screen decides by itself whether a save may lead to a send");
  assert.match(page, /openVerkoperPaneel\(poort\.fields\)/, "the panel is opened with a field list the screen made up");
  assert.match(page, /openVerkoperPaneel\(uitkomst\.fields\)/);

  // And the completion continues through the EXISTING send path — no second implementation, and
  // above all no number of its own.
  assert.match(page, /await handleSubmit\('sent'\)/, "the completion no longer continues into the existing send");

  // [NUMMER-EENMALIG] This line used to read:
  //
  //     assert.doesNotMatch(page, /\/api\/invoice\/numbering', \{\s*method/, …)
  //
  // — a blanket refusal of any numbering WRITE from this screen, and it went red the moment 2C
  // added one. It was right to, and it is answered rather than deleted: the screen may now write
  // numbering, because the one-time choice [EERSTE-DEUR] took off the new-account path has to be
  // put somewhere and the confirmation is the last place before it is fixed forever. What the
  // blanket ban was really protecting is narrower and is asserted instead, in the [NUMMER-EENMALIG]
  // gate below: the write goes to the EXISTING authority, only for an owner, only on an explicit
  // typed value, and it still mints nothing here.
  assert.match(page, /body: JSON\.stringify\(\{ invoice_start: numInput\.trim\(\) \}\)/,
    "the numbering write no longer goes to the one endpoint that parses, locks and seeds");
});

test("[VERKOPER-COMPLEET] the completion route is the owner's, refuses on a failed read, and writes only what is missing", () => {
  const route = code("src/app/api/invoice/verkoper/route.ts");

  // [ACTING-FOR] A sales member reads THEIR profile row, never their employer's. Without this
  // guard the screen would ask a member for their employer's BTW-id and then write it onto the
  // member's own row — the right answer stored against the wrong person.
  const guards = route.match(/const w = await requireOwner\(/g) ?? [];
  assert.equal(guards.length, 2, "both GET and POST must be owner-only");
  assert.match(route, /if \(w\.response\) return w\.response/);

  // [PROFILE-READ] Never a write on a read that failed, and never a form either.
  assert.match(route, /const read = classifyProfileRead\(/, "the profile is read without being classified");
  assert.match(route, /if \(read\.kind === 'failed'\)/);
  assert.match(route, /code: 'profiel_onleesbaar'/);
  inOrder(route, "read.kind === 'failed'", ".update(patch)",
    "api/invoice/verkoper/route.ts", "a save built on an unreadable profile can overwrite a value it never saw");

  // The precedence rule, made structural rather than trusted: a field that is NOT missing cannot
  // reach the patch at all, so no prefill — handoff or otherwise — can land on a saved value.
  assert.match(route, /if \(!missing\.includes\(field\)\) continue/,
    "the route writes fields it was handed rather than only the fields that are missing — a stale handoff can now overwrite a saved BTW-id");
  inOrder(route, "const missing = missingSellerFields(read.facts)", "patch[field] = cleaned.value",
    "api/invoice/verkoper/route.ts", "the writable set must be decided from the profile, not from the request body");

  // All or nothing: a partial write leaves the owner on a form that forgot half of what they typed.
  inOrder(route, "if (Object.keys(problems).length > 0)", ".update(patch)",
    "api/invoice/verkoper/route.ts", "a field that failed validation would be saved alongside the ones that passed");

  // An UPDATE that matched nothing is not a success — otherwise the screen sends and the door
  // refuses with the very fields the owner just typed.
  assert.match(route, /if \(!written \|\| written\.length === 0\)/, "a write that touched no row is being reported as saved");

  // It does not issue anything. The one authority stays the send door.
  assert.doesNotMatch(route, /invoice_number|next_invoice_seq|generateInvoiceNumber/,
    "the completion route grew an opinion about invoice numbering");
});

// ─── [NUMMER-EENMALIG] The wiring of the one-time numbering choice ────────────────────────────
//
// The DECISIONS live in numbering-first-send.ts and every branch of them is executed in
// numbering-first-send.test.ts. What no unit test can see is that the screen never forms its own
// opinion, and — the invariant this whole batch turns on — that nothing here mints, reserves or
// brings forward a legal invoice number. art. 35 Wet OB gives one gapless, forward-only series;
// a number drawn by a confirmation dialog is a gap nobody can close.

test("[NUMMER-EENMALIG] the confirmation asks the authority, and never decides for itself", () => {
  const page = code("src/app/dashboard/invoice/new/page.tsx");

  // 1 — The state comes from the SERVER's answer, classified. A screen that reads `locked`
  // itself is a screen that will one day read the string "false" as permission to edit.
  assert.match(page, /classifyNumberingRead\(nr\.status, nj\)/, "the load no longer classifies the numbering read");
  assert.match(page, /classifyNumberingRead\(res\.status, json\)/, "the confirmation no longer refreshes a classified state");
  assert.match(page, /const num = firstSendNumbering\(numState\)/, "the notice is decided somewhere other than the module");
  assert.match(page, /if \(!num\) return null/,
    "a state with nothing to offer must render nothing — an employee, a locked series and an unreadable lock all land here");
  // No second opinion about the lock anywhere on the screen.
  assert.doesNotMatch(page, /\bnj\?\.locked|json\?\.locked|\.locked\s*===|!!\s*\w+\.locked/,
    "the screen started reading the lock flag by itself instead of through the classifier");

  // 2 — The refresh happens when the dialog OPENS, not only at page load. The state that decides
  // whether a form is offered must be the state at the moment of deciding.
  assert.match(page, /function opendeBevestiging\(\)/, "the confirmation opens without refreshing the numbering state");
  inOrder(page, "setShowSendConfirm(true)", "void verversNummerstand()",
    "invoice/new/page.tsx", "the dialog must open first and refresh after — a slow GET may not hold up the confirmation");
  assert.match(page, /opendeBevestiging\(\)/, "the send button no longer goes through the refreshing opener");

  // 3 — ZERO SETUP. Accepting the default must cost no request at all, and that is decided by the
  // shared predicate rather than by an inline truthiness test that would fire on whitespace.
  assert.match(page, /if \(numberingChangeRequested\(numOpen, numInput\)\)/,
    "the screen decides by itself whether to write numbering — an untouched default may never POST");

  // 4 — Only a saved change continues. The type predicate makes this the compiler's business too,
  // but the call site still has to USE it.
  //
  // Cut the CONFIRM HANDLER out first and order inside it. Both markers below occur earlier in the
  // file — `setShowSendConfirm(false)` in the back-button close, `handleSubmit('sent')` in 2B's
  // completion helper — so an indexOf over the whole page compares the wrong pair and passes for
  // the wrong reason. The window's own bounds are real code (a function signature), never a
  // comment, because code() strips those and a -1 slice measures to the end of the file.
  const iStart = page.indexOf("async function bevestigVerzenden()");
  const iEnd = page.indexOf("async function handleSubmit(mode:");
  assert.ok(iStart >= 0, "bevestigVerzenden is gone — the confirmation no longer has a handler of its own");
  assert.ok(iEnd > iStart, "bevestigVerzenden must sit above handleSubmit, which it calls");
  const bevestig = page.slice(iStart, iEnd);
  assert.ok(bevestig.length > 400, "the bevestigVerzenden slice is real");

  assert.match(bevestig, /if \(!numberingSaveAllowsSend\(bewaard\)\)/, "a refused or failed numbering save may reach the send");
  inOrder(bevestig, "if (!numberingSaveAllowsSend(bewaard))", "setShowSendConfirm(false)",
    "bevestigVerzenden", "the dialog closes and sends before the numbering outcome is judged");
  inOrder(bevestig, "const bewaard = classifyNumberingSave(res.status, json)", "await handleSubmit('sent', true)",
    "bevestigVerzenden", "the send runs before the numbering answer is read");
  // It CONTINUES the same submit rather than starting a parallel one: `confirmed` is the flag that
  // skips the confirmation on the second pass, and nothing else in the file may set it.
  assert.equal([...page.matchAll(/handleSubmit\('sent', true\)/g)].length, 1,
    "more than one place claims an already-confirmed send — the confirmation would be skippable from elsewhere");
  // Both refusal paths RETURN. A branch that only sets an error and falls through would show the
  // message and send the invoice anyway — which is the one outcome that cannot be undone. Asserted
  // by shape rather than by counting `return`s: a tally breaks on any harmless refactor and says
  // nothing about which branch lost its exit.
  assert.match(bevestig, /\} catch \{\s*\n\s*setNumError\(t\('nieuw\.nummer\.opslaanMislukt'\)\); setNumBusy\(false\); return\s*\n\s*\}/,
    "a numbering request that never completed falls through into the send");
  assert.match(bevestig, /else setNumError\(failureText\([\s\S]{0,160}?\n\s*return\s*\n\s*\}/,
    "the refused-save branch does not return — the send would continue under numbering that was never stored");

  // 5 — And the number shown afterwards is the authority's, not the typed input.
  assert.match(page, /setNextNumber\(bewaard\.next\)/,
    "the screen shows what it typed instead of what the route says landed (the seed is clamped forward-only)");

  // 6 — THE INVARIANT. Nothing on this screen produces a number. next_invoice_seq() is the only
  // writer of the counter and the send route is its only caller.
  assert.doesNotMatch(page, /next_invoice_seq/, "the screen calls the allocator");
  assert.doesNotMatch(page, /formatInvoiceNumber\(/,
    "the screen formats a definitive number itself — previewInvoiceStart is a PREVIEW and says so");
  assert.match(page, /previewInvoiceStart\(getypt, amsterdamYear\(\)\)/,
    "the live preview no longer uses the authority's own parser, or no longer uses the owner's year");
});

test("[NUMMER-EENMALIG] the numbering step sits before the send and changes nothing after it", () => {
  const page = code("src/app/dashboard/invoice/new/page.tsx");

  // The whole sequence: the numbering step lives ABOVE the send path, so judging it happens first
  // and the existing chain — [VERKOPER-COMPLEET]'s seller gate, then the draft, then the route's
  // number — runs unchanged underneath it.
  inOrder(page, "async function bevestigVerzenden()", "const poort = await verkoperPoort()",
    "invoice/new/page.tsx", "the numbering step must come before the seller gate, which comes before the draft and the number");
  inOrder(page, "invoice_start: numInput.trim()", "await fetch('/api/invoice/send'",
    "invoice/new/page.tsx", "…and the numbering write must be settled before the door that mints the number is called at all");

  // [VERKOPER-COMPLEET] is untouched by this batch: the seller gate still runs inside handleSubmit,
  // still on the same narrow condition, and still before anything is created.
  const body = between(page, "async function handleSubmit(mode:", "const cfg = TYPE_CONFIG[invoiceType]",
    "the seller gate must be inside handleSubmit, not merely somewhere on the page");
  assert.ok(body.length > 500, "the handleSubmit slice is real");
  assert.match(body, /const poort = await verkoperPoort\(\)/, "2B's seller gate left handleSubmit");
  assert.doesNotMatch(body, /numbering|numState|numInput/,
    "numbering leaked into handleSubmit — the choice belongs on the confirmation, not on the send path");

  // A creditnota and an offerte never reach the confirmation, so the numbering notice is never
  // their business either. The condition lives in the preflight now, not on the button.
  assert.match(page, /if \(mode === 'sent' && invoiceType === 'factuur' && !confirmed\) \{\s*\n\s*opendeBevestiging\(\)\s*\n\s*return\s*\n\s*\}/,
    "the confirmation gate lost its narrow condition, or no longer returns — a creditnota or an offerte would be sent through a numbering dialog");
  assert.match(page, /if \(invoiceType !== 'factuur'\) return/,
    "the refresh runs for a document that draws no number from this series");

  // CONTAINMENT. The notice lives INSIDE the confirmation and nowhere else — the render suite
  // cannot see this (a server render opens no dialog, so "absent" is true there whatever the code
  // does), but source order can. A notice in the form body would put an irreversible-choice
  // warning in front of an owner who has not asked to send anything.
  // Bracketed by the confirmation's own opening and its own confirm button — both unique, both
  // real code. `t('nieuw.actie.annuleren')` was tried as the closing bound and rejected by
  // between(): that label is used elsewhere on the page and occurs BEFORE the dialog, so the
  // window would have been inverted. That rejection is the helper doing its job.
  assert.equal([...page.matchAll(/data-nummer-eenmalig/g)].length, 1,
    "the numbering notice is rendered in more than one place");
  inOrder(page, "{showSendConfirm && (", "data-nummer-eenmalig",
    "invoice/new/page.tsx", "the notice is rendered above the confirmation it belongs to");
  inOrder(page, "data-nummer-eenmalig", "void bevestigVerzenden()",
    "invoice/new/page.tsx", "the notice sits below the confirmation's own send button — it has left the dialog");
});

// ─── [NUMMER-EENMALIG] A numbering write may only follow a passing preflight ──────────────────
//
// THE DEFECT THIS EXISTS FOR, in the shape it actually had. The confirmation used to be the FIRST
// thing the factuur button did, so the flow was:
//
//     open confirmation → optional POST /api/invoice/numbering → handleSubmit → validations →
//     verkoperPoort → draft → /api/invoice/send
//
// A numbering write could therefore land on a document that then failed validation or the seller
// gate. And seed_invoice_counter is deliberately one-way — `last_seq = GREATEST(existing,
// requested)` — so an owner who typed a number equivalent to sequence 100, hit a field error, and
// afterwards wanted 45 could not get there: the floor had moved, on a series that had never issued
// a single invoice. A failed attempt left a permanent change behind.
//
// The order is now: validations → verkoperPoort → confirmation → optional POST → draft → send.
//
// ── WHY THIS IS NOT A PLAIN inOrder OVER THE FILE ──
// The ordering is no longer textual. `bevestigVerzenden` (which holds the POST) sits ABOVE
// handleSubmit in the source, because handleSubmit calls back into it via the dialog. Source
// position therefore proves nothing on its own. What CAN be proven is the reachability chain: the
// POST lives in one function, that function is reached from one button, that button only exists
// inside a dialog opened by one function, and that function is called from exactly one place —
// inside handleSubmit, after the poort. Each link is a uniqueness count, so a second door anywhere
// along it turns this red.
test("[NUMMER-EENMALIG] the numbering write is reachable only after the validations and the seller gate", () => {
  const page = code("src/app/dashboard/invoice/new/page.tsx");

  // LINK 1 — the POST exists in exactly one place, and that place is bevestigVerzenden.
  assert.equal([...page.matchAll(/invoice_start: numInput\.trim\(\)/g)].length, 1,
    "the numbering write has a second call site");
  const bevestig = between(page, "async function bevestigVerzenden()", "async function handleSubmit(mode:",
    "the numbering write must live in the confirmation handler");
  assert.match(bevestig, /invoice_start: numInput\.trim\(\)/, "the numbering write left the confirmation handler");

  // LINK 2 — bevestigVerzenden is reached from exactly one control, and it is inside the dialog.
  assert.equal([...page.matchAll(/bevestigVerzenden\(\)/g)].length, 2,
    "bevestigVerzenden has more than its declaration and the confirmation's own button");
  inOrder(page, "{showSendConfirm && (", "void bevestigVerzenden()",
    "invoice/new/page.tsx", "the confirm handler is invoked from outside the confirmation");

  // LINK 3 — the dialog can only be opened by opendeBevestiging, from exactly one place.
  assert.equal([...page.matchAll(/setShowSendConfirm\(true\)/g)].length, 1,
    "something other than opendeBevestiging opens the confirmation — a numbering dialog would be reachable without a preflight");
  const opener = between(page, "function opendeBevestiging()", "async function bevestigVerzenden()",
    "the one opener must sit above the confirm handler");
  assert.match(opener, /setShowSendConfirm\(true\)/, "the opener no longer opens the dialog");
  assert.equal([...page.matchAll(/opendeBevestiging\(\)/g)].length, 2,
    "opendeBevestiging is called from more than one place — only the preflight may open the confirmation");

  // LINK 4 — and that one call sits inside handleSubmit, AFTER the field validations and AFTER the
  // seller gate. This is the assertion the defect would have failed.
  const body = between(page, "async function handleSubmit(mode:", "const cfg = TYPE_CONFIG[invoiceType]",
    "the confirmation must be opened from inside the preflight");
  assert.match(body, /opendeBevestiging\(\)/, "the preflight no longer opens the confirmation");
  inOrder(body, "setFieldErrors({ ...errs, lines: lineErrs })", "const poort = await verkoperPoort()",
    "handleSubmit", "the seller gate runs before the ordinary field validation has spoken");
  inOrder(body, "const poort = await verkoperPoort()", "opendeBevestiging()",
    "handleSubmit", "THE DEFECT: the confirmation — and with it the numbering write — is reachable before the seller gate");
  inOrder(body, "opendeBevestiging()", "await fetch('/api/invoice/draft'",
    "handleSubmit", "the draft is created before the confirmation is answered");
  inOrder(body, "await fetch('/api/invoice/draft'", "await fetch('/api/invoice/send'",
    "handleSubmit", "the send door is called before the draft exists");

  // And the button no longer decides any of this: one entry for all three document types.
  assert.doesNotMatch(page, /if \(invoiceType === 'factuur'\) \{\s*\n\s*opendeBevestiging/,
    "the button opens the confirmation directly again, skipping the preflight entirely");
  assert.match(page, /setShowSendConfirm\(true\)\s*\n[\s\S]{0,400}?void verversNummerstand\(\)/,
    "the opener no longer refreshes the lock state after opening");
});
