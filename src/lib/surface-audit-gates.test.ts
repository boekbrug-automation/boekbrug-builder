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

/** Full-line comments out; inline ones stay. Cheap, and blind to `/*` inside an attribute string. */
function strip(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")        // {/* JSX comment */}
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*\n?/gm, "") // a block comment that opens a line
    .replace(/^[ \t]*\/\/.*$/gm, "");           // a line comment that is the whole line
}
const code = (path: string): string => strip(readFileSync(path, "utf8"));

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
  assert.match(cb, /planAfterOAuth\(\s*\{[\s\S]{0,200}?\},\s*profileRead,\s*\)/,
    "the plan is handed something other than the classified read");

  // Every write in the route is plan-driven. The name backfill is the one that used to sit
  // outside the plan, so a plan that ordered nothing still left it standing.
  assert.match(cb, /\} else if \(plan\.backfillName && metaName\) \{/,
    "the full_name backfill is loose from the plan again");
  for (const [write, guard] of [
    ["upsert", /if \(plan\.profileToCreate\) \{/],
    ["role update", /if \(plan\.roleUpdate\) \{/],
    ["markArchief", /if \(plan\.markArchief\) \{/],
  ] as const) {
    assert.match(cb, guard, `the ${write} is no longer behind its plan field`);
  }
  // And it says so when it could not look: from the visitor's side a failed read is an ordinary
  // sign-in, so the log is the only place this can ever surface.
  assert.match(cb, /profileRead\.kind === 'failed'[\s\S]{0,400}?console\.error\('\[PROFILE-READ\] profile unreadable in the OAuth callback/,
    "a failed read in the callback passes silently");
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
