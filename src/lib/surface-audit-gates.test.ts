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
test("[PROFILE-READ] the three readers on the gate keep a failed read apart from a missing row", () => {
  for (const f of ["src/middleware.ts", "src/app/dashboard/page.tsx", "src/app/onboarding/page.tsx"]) {
    const src = code(f);
    assert.match(src, /import \{ classifyProfileRead \} from ["']@\/lib\/profile-read["']/,
      `${f} no longer reads the profile through the one classifier`);
  }

  // The middleware never decides anything on a null it cannot explain.
  const mw = code("src/middleware.ts");
  assert.match(mw, /select\("onboarding_done"\)\.eq\("id", user\.id\)\.maybeSingle\(\)/,
    "the middleware's profile read is back to .single(), which reports a missing row as an error");
  assert.doesNotMatch(mw, /if \(profile && !profile\.onboarding_done\)/, "the data-only test is back");
  assert.match(mw, /profileRead\.kind === "failed"/, "a failed read is not named as such");
  assert.match(mw, /profileRead\.kind === "row" && !profileRead\.row\.onboarding_done/,
    "the wizard redirect must rest on a ROW that says onboarding is not done");

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
  assert.match(page, /import \{ quarterFromParams \} from '@\/lib\/quarter'/);
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
