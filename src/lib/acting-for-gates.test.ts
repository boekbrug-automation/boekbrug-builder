// [ACTING-FOR] Pure node test — run: npx tsx --test src/lib/acting-for-gates.test.ts
//
// WHY THIS TEST EXISTS
//
// A sales member shares the session shape of an ordinary user: they are logged in, they have a
// user.id, and every existing invoice route assumes THAT id owns the administration. The routes
// they need have been rebuilt to act ON BEHALF OF the owner (see the REBUILT list below); the
// rest is deliberately closed (owner-only.ts).
//
// THE BUG THIS PREVENTS
// In six months someone adds /api/invoice/something-new, writes `sender_id: user.id` like
// everywhere else, and nothing visible happens — except that a member opens a second number
// series under the same VAT number there. Art. 35 Wet OB requires gapless sequential numbering,
// and an issued number never comes back. You discover a mistake like that during an audit, not
// in an error message.
//
// Hence: every route under /api/invoice must do ONE OF TWO things — resolve the owner
// (getActingFor) or refuse a member (requireOwner). Saying nothing is not an option.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/app/api/invoice";

function allRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...allRoutes(path));
    else if (name === "route.ts") out.push(path);
  }
  return out;
}

test("there are invoice routes to guard", () => {
  // Safety net under the safety net: if the folder moves, the test below would run over an empty
  // list and always pass. An empty gate is worse than no gate.
  const routes = allRoutes(ROOT);
  assert.ok(routes.length >= 8, `only ${routes.length} routes found under ${ROOT}`);
});

test("every invoice route resolves the owner OR refuses a member", () => {
  const silent: string[] = [];
  for (const path of allRoutes(ROOT)) {
    const src = readFileSync(path, "utf8");
    const actsForOwner = /getActingFor/.test(src);
    const refuses = /requireOwner/.test(src);
    if (!actsForOwner && !refuses) silent.push(path);
  }
  assert.deepEqual(
    silent,
    [],
    "These routes say nothing about who is acting. Pick one of two:\n" +
      "  · rebuilt: getActingFor() + invoiceOwnerId() — like /api/invoice/send;\n" +
      "  · not yet in scope: requireOwner('…') at the top of the handler.\n" +
      "Doing nothing means a sales member books here under THEIR own id, and that is a second " +
      "number series under their employer's VAT number.",
  );
});

/**
 * The routes a sales member actually walks through — the whole lifecycle of an invoice as they
 * can travel it: create, save/edit/discard, send, remind, duplicate, correct with a credit note,
 * and attach a payment link.
 *
 * Each of these must have resolved the OWNER. Forget one and the member books there under their
 * own id — and then two number series run under one VAT number.
 */
const REBUILT = [
  "src/app/api/invoice/draft/route.ts",
  "src/app/api/invoice/send/route.ts",
  "src/app/api/invoice/[id]/route.ts",
  "src/app/api/invoice/[id]/duplicate/route.ts",
  "src/app/api/invoice/[id]/reminder/route.ts",
  "src/app/api/invoice/creditnota/route.ts",
  "src/app/api/invoice/[id]/betaalverzoek/route.ts",
];

test("every route a member may use bills in the name of the OWNER", () => {
  for (const path of REBUILT) {
    const src = readFileSync(path, "utf8");
    assert.ok(/getActingFor/.test(src), `${path} does not resolve the owner`);
    assert.ok(/invoiceOwnerId/.test(src), `${path} does not use invoiceOwnerId()`);
  }
});

test("none of those routes still decides ownership with user.id", () => {
  // The shape that used to be everywhere in this codebase: `.eq('sender_id', user.id)` or
  // `sender_id: user.id`. That is exactly what breaks as soon as the logged-in human is not the
  // owner. Audit lines (`userId: user.id`) DO stay allowed — those should name the ACTOR.
  for (const path of REBUILT) {
    const src = readFileSync(path, "utf8");
    for (const pattern of [
      /\.eq\(\s*['"]sender_id['"]\s*,\s*user\.id\s*\)/,
      /sender_id:\s*user\.id/,
      /generateInvoiceNumber\([^)]*,\s*user\.id\s*,/,
      /\$\{user\.id\}\/facturen/,
    ]) {
      assert.ok(
        !pattern.test(src),
        `${path} still decides ownership with user.id (${pattern}) — that should be ownerId`,
      );
    }
  }
});

test("the two routes that ISSUE a number do it with the session client", () => {
  // next_invoice_seq() refuses unconditionally as soon as auth.uid() is NULL. So service_role
  // cannot step in here, and that is the guard preventing an arbitrary server route from issuing
  // numbers. See company_members_sales_role.sql.
  for (const path of ["src/app/api/invoice/send/route.ts", "src/app/api/invoice/creditnota/route.ts"]) {
    const src = readFileSync(path, "utf8");
    assert.ok(
      /generateInvoiceNumber\(\s*supabase\s*,\s*ownerId\s*,/.test(src),
      `${path}: the number must come from ownerId's series, via the session client`,
    );
    assert.ok(
      !/generateInvoiceNumber\(\s*createPipelineClient\(\)/.test(src),
      `${path}: service_role must not mint numbers`,
    );
  }
});

test("nobody writes created_by without a fallback — that broke invoice creation", () => {
  // THIS ACTUALLY HAPPENED, AND IT WAS THE MOST SERIOUS BUG OF THIS WHOLE BUILD.
  //
  // created_by comes from company_members_sales_role.sql. The code writing it was already on
  // main, with `as any` next to it because the generated types do not know it. But `as any`
  // silences the TYPE CHECKER, not the database: as long as the migration is not applied,
  // PostgREST answers PGRST204 and the WHOLE request fails. On such an installation no invoice
  // could be created any more — by anyone.
  //
  // tsc was clean, 441 tests were green, the build succeeded. None of the three looks at a real
  // database. So the rule now lives here, where it IS checked.
  const SCANNED = ["src/app/api", "src/app/dashboard"];
  const toCheck: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.tsx?$/.test(name)) toCheck.push(path);
    }
  };
  for (const d of SCANNED) walk(d);

  // ── The one shape this rule does NOT describe ──────────────────────────────────────────────
  //
  // The danger above is a column BOLTED ONTO a table that already exists everywhere: invoices and
  // clients are present on every installation, so a missing `created_by` turns a working request
  // into PGRST204 and nothing else changes. writeWithTrail() exists for exactly that.
  //
  // plan_grants.created_by is not that shape. It arrived WITH its own table (plan_grants.sql), so
  // on a database without that migration the table is absent too — the insert fails on the table,
  // not on the column, and a fallback that drops the key would change a clear failure into a grant
  // with no author. Routing it through writeWithTrail() would be cargo cult: it would silence
  // nothing that can happen and would lose the one field that answers "who gave this account Plus".
  //
  // Named per FILE and not per table, because that is what this scan can see. A new entry here is
  // therefore a deliberate sentence somebody has to write, which is the point.
  const EIGEN_KOLOM = new Set<string>([
    join("src/app/api/control/toekenning", "route.ts"),
  ]);

  const offending: string[] = [];
  for (const path of toCheck) {
    const src = readFileSync(path, "utf8");
    // Only a WRITE counts: created_by inside an .insert()/.update()/.upsert().
    //
    // Not every occurrence is one. A type declaration (`{ id: string; created_by: string }`), a
    // read filter (`.eq('created_by', …)`) and a select list touch the column too, but those are
    // either harmless or already caught in a try/catch. This test first tripped on such a type
    // declaration — a gate that fires on the wrong things teaches people to ignore it.
    const writes = /\.(insert|update|upsert)\([\s\S]{0,4000}?created_by/.test(src);
    if (!writes) continue;
    // Only allowed inside the fallback, or when the key arrives via `...trail`.
    if (!/writeWithTrail/.test(src) && !EIGEN_KOLOM.has(path)) offending.push(path);
  }
  assert.deepEqual(
    offending,
    [],
    "These files write created_by directly. On a database without the migration that request " +
      "fails entirely (PGRST204). Use writeWithTrail() from src/lib/created-by.ts.",
  );
});

test("what a member may NOT do refuses them with a readable sentence", () => {
  // The other side of the boundary. These routes all assume the logged-in human is the owner;
  // they are deliberately shut rather than half rebuilt.
  for (const path of [
    "src/app/api/invoice/numbering/route.ts",      // changes the series for the whole company
    "src/app/api/invoice/pay-toggle/route.ts",     // touches money truth and bank reconciliation
    "src/app/api/invoice/schedules/route.ts",      // a standing obligation
    "src/app/api/invoice/[id]/archive/route.ts",   // taking an invoice out of the books
  ]) {
    const src = readFileSync(path, "utf8");
    assert.ok(/requireOwner/.test(src), `${path} should be shut for a member`);
  }
});

test("the send route mints the number in the name of the OWNER", () => {
  // The only line in the codebase where a legally binding invoice number comes into existence.
  // Were `user.id` ever to reappear here, every member would get their own series — the bug this
  // whole build had to prevent, in one word.
  const src = readFileSync("src/app/api/invoice/send/route.ts", "utf8");
  assert.ok(
    /generateInvoiceNumber\(\s*supabase\s*,\s*ownerId\s*,/.test(src),
    "generateInvoiceNumber must receive ownerId — not user.id",
  );
  // And with the SESSION client: next_invoice_seq() refuses unconditionally as soon as
  // auth.uid() is NULL, so service_role cannot step in here.
  assert.ok(
    !/generateInvoiceNumber\(\s*createPipelineClient\(\)/.test(src),
    "service_role must not mint numbers — see the guard in next_invoice_seq()",
  );
});

test("the browser no longer writes invoices directly", () => {
  // The page did `supabase.from('invoices').insert({ sender_id: user.id, ... })`. That was fine
  // while there was one human per administration. If that shape returns, the BROWSER decides who
  // the owner is again — and then /api/invoice/draft is a detour nobody takes.
  const page = readFileSync("src/app/dashboard/invoice/new/page.tsx", "utf8");
  assert.ok(
    !/from\(['"]invoices['"]\)\s*\.insert/.test(page),
    "the new-invoice page must not write to invoices itself — that goes via /api/invoice/draft",
  );
  assert.ok(
    !/from\(['"]invoice_lines['"]\)\s*\.insert/.test(page),
    "and not to invoice_lines either",
  );
  assert.ok(/\/api\/invoice\/draft/.test(page), "it should use the server route");
});

test("[SEND-EMAIL-DURABLE] a failed e-mail leaves a durable trace, not only a response field", () => {
  // The state this guards is the quietest one the invoice path can reach: the number is
  // consumed (art. 35, no rollback), the status says 'sent', the PDF is stored, the BTW is
  // declared on it — and the customer received nothing. The screens do surface
  // warning==='email_failed', but that signal lives exactly as long as the HTTP response: close
  // the tab, lose signal on a phone after the server committed, and it is gone with no trace.
  //
  // Unlike the PDF-failure path above it, nothing else would ever catch this — there the missing
  // PDF eventually shows up in the closing package. Here everything looks perfect.
  const src = readFileSync("src/app/api/invoice/send/route.ts", "utf8");
  const emailCatch = src.slice(src.indexOf("catch (emailErr)"), src.indexOf("── 15."));
  // [NOTIFY-EEN-DEUR] This named the WRITE SHAPE — `from('notifications').insert` — and so it went
  // red the moment the branch started calling the canonical writer instead, which holds the
  // property strictly better (it also reaches the owner's phone, and it reports a refused insert
  // instead of dropping it). The rule is "this branch tells a person", so that is what it asks for
  // now: a call to createNotification, the one door.
  assert.ok(
    /createNotification\(/.test(emailCatch),
    "the e-mail failure branch must write a notification, not only set the response warning",
  );
  assert.ok(
    /acting\.actorId/.test(emailCatch),
    "and reach whoever pressed send, not only the owner — they are the one who saw it happen",
  );
});
