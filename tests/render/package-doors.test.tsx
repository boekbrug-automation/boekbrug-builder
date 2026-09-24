// tests/render/package-doors.test.tsx
// [PACKAGE-FAIL-CLOSED] The four places a quarter package leaves the building, with one source of
// the package made unreadable at a time.
//
// Run: npm run test:render
//
// ── WHY THIS LIVES IN tests/render ──
// It renders no screen. It lives here because this is the runner in the gate set that has
// `--experimental-test-module-mocks`, and these are the real route modules: only the two Supabase
// client factories are replaced, by a fake PostgREST (tests/support/package-fake-db.ts). Rate
// limiting, the audit log, notifications, the cron heartbeat and the mail sender all run their own
// code against that fake — the only other seam is Resend's HTTP call, caught at `fetch`.
//
// ── WHAT IS ASSERTED ──
// "Failed financial read ≠ empty financial period." For each door, a required source that cannot be
// read must end in: a retryable 503, no ZIP bytes, no record that a package was delivered or
// downloaded, and no mail that announces a complete package. A read that succeeds and returns
// nothing is a quarter that is empty, and still gets its package. Nothing about who may open which
// package changes.

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { makeFakeDb, type Failure, type Query, type Row, type StorageFailure } from "../support/package-fake-db";
import { failRead, failSecondPage } from "../support/package-sources";
import {
  OWNER, OWNER2, ACCOUNTANT, STRANGER, SHARE_TOKEN, YEAR, QUARTER,
  quarterTables, quarterStorage, emptyQuarterTables, withManyCardPayouts,
} from "../support/package-quarter";

process.env.RESEND_API_KEY ??= "re_package_doors_test";
process.env.CRON_SECRET = "package-doors-cron-secret";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://package-doors.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "package-doors-anon-key";
process.env.NEXT_PUBLIC_APP_URL ??= "https://app.example.invalid";

// ── The two client factories, pointed at whichever fake the current test set up ──────────────────

let db = makeFakeDb(quarterTables(), { storage: quarterStorage() });
let sessionUser: string | null = OWNER;

mock.module(new URL("../../src/lib/supabase-pipeline.ts", import.meta.url).href, {
  namedExports: { createPipelineClient: () => db.client },
});
mock.module(new URL("../../src/lib/supabase-server.ts", import.meta.url).href, {
  namedExports: {
    createServerSupabaseClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: sessionUser ? { id: sessionUser, email: `${sessionUser}@example.invalid` } : null } }),
      },
      from: (table: string) => db.client.from(table),
    }),
  },
});

// ── Resend, caught at the wire ─────────────────────────────────────────────────────────────────

interface SentMail { to: unknown; subject: string; html: string }
const mails: SentMail[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("https://api.resend.com/")) {
    const body = JSON.parse(String(init?.body ?? "{}"));
    mails.push({ to: body.to, subject: String(body.subject ?? ""), html: String(body.html ?? "") });
    return new Response(JSON.stringify({ id: `mail-${mails.length}` }), { status: 200, headers: { "content-type": "application/json" } });
  }
  throw new Error(`[PACKAGE-FAIL-CLOSED] a door test tried to reach the network: ${url}`);
}) as typeof fetch;

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────

function scenario(opts: {
  failures?: Failure[];
  tables?: Record<string, Row[]>;
  user?: string | null;
  storageFailures?: StorageFailure[];
  onQuery?: (q: Query) => void;
} = {}) {
  db = makeFakeDb(opts.tables ?? quarterTables(), {
    failures: opts.failures, storage: quarterStorage(), storageFailures: opts.storageFailures, onQuery: opts.onQuery,
  });
  sessionUser = opts.user === undefined ? OWNER : opts.user;
  mails.length = 0;
  return db;
}

const writesTo = (table: string) => db.writes().filter((q) => q.table === table);
const auditActions = () => writesTo("audit_logs").map((q) => (q.payload as Row).action);

const quiet = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const e = console.error, w = console.warn, l = console.log;
  console.error = () => {}; console.warn = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.error = e; console.warn = w; console.log = l; }
};

async function isZip(res: Response): Promise<boolean> {
  const bytes = new Uint8Array(await res.clone().arrayBuffer());
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/** The one shape every unavailable-source refusal must have, whichever door it came through. */
async function assertRetryableRefusal(res: Response, name: string) {
  assert.equal(res.status, 503, `${name}: an unreadable source is a retryable 503, got ${res.status}`);
  assert.ok(Number(res.headers.get("retry-after")) > 0, `${name}: a retryable refusal says when to retry`);
  assert.notEqual(res.headers.get("content-type"), "application/zip", `${name}: no ZIP content type`);
  assert.equal(res.headers.get("content-disposition"), null, `${name}: nothing is offered for saving`);
  assert.equal(await isZip(res), false, `${name}: no ZIP bytes, not even a partial one`);
}

// The sources each door is walked through: every class the fix covers, both failure shapes.
const DOOR_FAILURES: [string, Failure[], (() => Record<string, Row[]>)?][] = [
  ["card payouts ({ error })", [failRead("pos_income", "error")]],
  ["card payouts, page two only", [failSecondPage("pos_income", "error")], () => withManyCardPayouts(quarterTables(), 1001)],
  ["cash movements (thrown)", [failRead("cash_entries", "throw")]],
  ["cash turnover ({ error })", [failRead("cash_turnover", "error")]],
  ["till turnover ({ error })", [failRead("daily_turnover", "error")]],
  ["terminal settlements (thrown)", [failRead("eft_settlements", "throw")]],
  ["bank lines ({ error })", [failRead("bank_transactions", "error")]],
  ["PIN ledger ({ error })", [failRead("pin_ledger", "error")]],
  ["kasboek history (thrown)", [failRead("kasboek_entries", "throw")]],
  ["art. 29 clawback ({ error })", [failRead("vat_clawback", "error")]],
  ["the quarter's invoices (thrown)", [failRead("invoices", "throw")]],
];

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Door 1 — /api/closing-package: the owner and the linked accountant
// ════════════════════════════════════════════════════════════════════════════════════════════════

const closingPackage = () => import("../../src/app/api/closing-package/route");

function packageRequest(query: string, accept = "*/*") {
  return new NextRequest(`http://localhost/api/closing-package?${query}`, { headers: { accept } });
}

test("[PACKAGE-FAIL-CLOSED] owner door, healthy quarter: the owner gets a ZIP and nothing is logged as an accountant download", async () => {
  scenario({ user: OWNER });
  const { GET } = await closingPackage();
  const res = await quiet(() => GET(packageRequest(`year=${YEAR}&quarter=${QUARTER}`)));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/zip");
  assert.equal(await isZip(res), true);
  assert.deepEqual(auditActions(), [], "an owner fetching their own quarter is not an accountant download");
});

test("[PACKAGE-FAIL-CLOSED] accountant door, healthy quarter: ZIP, and the download is recorded exactly once", async () => {
  scenario({ user: ACCOUNTANT });
  const { GET } = await closingPackage();
  const res = await quiet(() => GET(packageRequest(`year=${YEAR}&quarter=${QUARTER}&clientId=${OWNER}`)));
  assert.equal(res.status, 200);
  assert.equal(await isZip(res), true);
  assert.deepEqual(auditActions(), ["accountant.package_downloaded"]);
  const row = writesTo("audit_logs")[0].payload as Row;
  assert.equal(row.user_id, ACCOUNTANT);
});

test("[PACKAGE-FAIL-CLOSED] accountant door: an unreadable source is a 503 with no ZIP and no download on record", async () => {
  const { GET } = await closingPackage();
  for (const [name, failures, tables] of DOOR_FAILURES) {
    scenario({ user: ACCOUNTANT, failures, tables: tables?.() });
    const res = await quiet(() => GET(packageRequest(`year=${YEAR}&quarter=${QUARTER}&clientId=${OWNER}`)));
    await assertRetryableRefusal(res, name);
    assert.deepEqual(auditActions(), [], `${name}: a package that was not built was not downloaded`);
    const body = await res.json();
    assert.match(String(body.error), /opnieuw/i, `${name}: the refusal tells the reader to retry`);
  }
});

test("[PACKAGE-FAIL-CLOSED] owner door: the same refusal, and a browser navigation gets a page in Dutch, not JSON", async () => {
  const { GET } = await closingPackage();
  scenario({ user: OWNER, failures: [failRead("daily_turnover", "error")] });
  const res = await quiet(() => GET(packageRequest(`year=${YEAR}&quarter=${QUARTER}`, "text/html")));
  await assertRetryableRefusal(res, "owner, till unreadable");
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
  const html = await res.text();
  assert.match(html, /<html lang="nl">/);
  assert.match(html, /kon nu niet (volledig )?worden gelezen/, "the page says a source could not be read");
  assert.doesNotMatch(html, /halverwege/, "and does not call it a half-finished build");
});

test("[PACKAGE-FAIL-CLOSED] owner door: an empty quarter read in full is still a package", async () => {
  scenario({ user: OWNER, tables: emptyQuarterTables() });
  const { GET } = await closingPackage();
  const res = await quiet(() => GET(packageRequest(`year=${YEAR}&quarter=${QUARTER}`)));
  assert.equal(res.status, 200, "zero rows read successfully is a quarter without transactions, not an outage");
  assert.equal(await isZip(res), true);
});

test("[PACKAGE-FAIL-CLOSED] owner door: a build failure that is not a source stays a 500 — distinguishable, and nothing recorded", async () => {
  // An invoice number that is not text breaks the pure assembly, not a read.
  const tables = quarterTables();
  Object.assign(tables.invoices.find((i) => i.id === "out-2")!, { invoice_number: { corrupt: true } });
  scenario({ user: ACCOUNTANT, tables });
  const { GET } = await closingPackage();
  const res = await quiet(() => GET(packageRequest(`year=${YEAR}&quarter=${QUARTER}&clientId=${OWNER}`)));
  assert.equal(res.status, 500);
  assert.equal(res.headers.get("retry-after"), null, "not presented as a source outage");
  assert.equal(await isZip(res), false);
  assert.deepEqual(auditActions(), []);
});

test("[PACKAGE-FAIL-CLOSED] owner door: who may fetch which quarter is unchanged", async () => {
  const { GET } = await closingPackage();

  scenario({ user: null });
  assert.equal((await quiet(() => GET(packageRequest(`year=${YEAR}&quarter=${QUARTER}`)))).status, 401);

  // An accountant who is not linked to this client.
  scenario({ user: STRANGER });
  let res = await quiet(() => GET(packageRequest(`year=${YEAR}&quarter=${QUARTER}&clientId=${OWNER}`)));
  assert.equal(res.status, 403);
  assert.ok(!db.seen.some((q) => q.table === "invoices"), "nothing of the client is read for a stranger");
  assert.deepEqual(auditActions(), []);

  // A linked row alone is not enough when the caller is not in accountant mode, and the role alone
  // is not enough without the link (the stranger above).
  const tables = quarterTables();
  tables.accountant_clients.push({ id: "link-x", accountant_id: OWNER, zzper_id: STRANGER });
  scenario({ user: OWNER, tables });
  res = await quiet(() => GET(packageRequest(`year=${YEAR}&quarter=${QUARTER}&clientId=${STRANGER}`)));
  assert.equal(res.status, 403);
  assert.deepEqual(auditActions(), []);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Door 2 — /api/pakket: the share link, no account
// ════════════════════════════════════════════════════════════════════════════════════════════════

const pakket = () => import("../../src/app/api/pakket/route");
const tokenRequest = (token: string) => new NextRequest(`http://localhost/api/pakket?token=${token}`);

test("[PACKAGE-FAIL-CLOSED] token door, healthy quarter: ZIP, one delivery fingerprint, the counter and the audit row", async () => {
  scenario({ user: null });
  const { GET } = await pakket();
  const res = await quiet(() => GET(tokenRequest(SHARE_TOKEN)));
  assert.equal(res.status, 200);
  assert.equal(await isZip(res), true);
  assert.equal(writesTo("package_deliveries").length, 1, "what was handed over is recorded");
  const counter = writesTo("package_shares").filter((q) => q.write === "update");
  assert.equal(counter.length, 1);
  assert.equal((counter[0].payload as Row).download_count, 1);
  assert.deepEqual(auditActions(), ["package.link_downloaded"]);
  // Everything built came from the share row's owner, never from anything in the URL.
  const scoped = db.seen.filter((q) => q.write === null && q.filters.some((f) => f.col === "user_id"));
  assert.ok(scoped.length > 10);
  assert.ok(scoped.every((q) => q.filters.some((f) => f.col === "user_id" && f.val === OWNER)), "every owner-scoped read is scoped to the share's owner");
});

test("[PACKAGE-FAIL-CLOSED] token door: an unreadable source is a 503 with no ZIP, no delivery, no counter, no audit, no notification", async () => {
  const { GET } = await pakket();
  for (const [name, failures, tables] of DOOR_FAILURES) {
    scenario({ user: null, failures, tables: tables?.() });
    const res = await quiet(() => GET(tokenRequest(SHARE_TOKEN)));
    await assertRetryableRefusal(res, name);
    assert.equal(writesTo("package_deliveries").length, 0, `${name}: no delivery fingerprint for a package that was not built`);
    assert.equal(writesTo("package_shares").length, 0, `${name}: the download counter does not move`);
    assert.deepEqual(auditActions(), [], `${name}: no "link downloaded" on record`);
    assert.equal(writesTo("notifications").length, 0, `${name}: the owner is not told his accountant fetched anything`);
    const html = await res.text();
    assert.match(html, /opnieuw/, `${name}: the page says to try again`);
    assert.doesNotMatch(html, /werkt niet meer|nieuwe link/, `${name}: the link still works, and the page must not say otherwise`);
  }
});

test("[PACKAGE-FAIL-CLOSED] token door: a build failure that is not a source stays a 500 and records nothing", async () => {
  const tables = quarterTables();
  Object.assign(tables.invoices.find((i) => i.id === "out-2")!, { invoice_number: { corrupt: true } });
  scenario({ user: null, tables });
  const { GET } = await pakket();
  const res = await quiet(() => GET(tokenRequest(SHARE_TOKEN)));
  assert.equal(res.status, 500);
  assert.equal(res.headers.get("retry-after"), null);
  assert.equal(await isZip(res), false);
  assert.equal(writesTo("package_deliveries").length, 0);
  assert.equal(writesTo("package_shares").length, 0);
  assert.deepEqual(auditActions(), []);
});

test("[PACKAGE-FAIL-CLOSED] token door: the token still opens exactly one quarter, and dead links stay dead", async () => {
  const { GET } = await pakket();
  scenario({ user: null });
  assert.equal((await quiet(() => GET(tokenRequest("not-a-token")))).status, 400);
  scenario({ user: null });
  assert.equal((await quiet(() => GET(tokenRequest("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")))).status, 404);
  const revoked = quarterTables();
  Object.assign(revoked.package_shares[0], { revoked_at: "2026-04-01T00:00:00Z" });
  scenario({ user: null, tables: revoked });
  assert.equal((await quiet(() => GET(tokenRequest(SHARE_TOKEN)))).status, 404);
  assert.ok(!db.seen.some((q) => q.table === "invoices"), "a revoked link builds nothing");
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Door 3 — the quarter cron: "het kwartaalpakket staat klaar" to the accountant
// ════════════════════════════════════════════════════════════════════════════════════════════════

const cron = () => import("../../src/app/api/cron/quarter-close/route");
const cronRequest = () =>
  new NextRequest(`http://localhost/api/cron/quarter-close?year=${YEAR}&quarter=${QUARTER}`, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });

/** A quarter whose only open point is one unplaced bank line — the gap the accountant must hear about. */
function tidyQuarter(): Record<string, Row[]> {
  const t = quarterTables();
  t.bank_transactions = t.bank_transactions.filter((b) => b.id !== "bt-003");
  t.invoices = t.invoices.filter((i) => !["out-old", "in-old"].includes(String(i.id)));
  return t;
}

test("[PACKAGE-FAIL-CLOSED] quarter cron, healthy: the accountant is mailed the quarter WITH its open point", async () => {
  scenario({ user: null, tables: tidyQuarter() });
  const { GET } = await cron();
  const res = await quiet(() => GET(cronRequest()));
  const body = await res.json();
  assert.equal(body.failed, 0, JSON.stringify(body));
  assert.equal(body.notifiedAccountants, 1);
  const toAccountant = mails.filter((m) => JSON.stringify(m.to).includes("boekhouder@example.invalid"));
  assert.equal(toAccountant.length, 1);
  assert.match(toAccountant[0].html, /Nog niet compleet/, "the open point reaches the accountant");
  assert.match(toAccountant[0].html, /niet geplaatst/);
});

test("[PACKAGE-FAIL-CLOSED] quarter cron: a genuinely clean quarter is still announced as ready", async () => {
  const t = tidyQuarter();
  t.bank_transactions = t.bank_transactions.filter((b) => b.id !== "bt-007");
  scenario({ user: null, tables: t });
  const { GET } = await cron();
  const body = await (await quiet(() => GET(cronRequest()))).json();
  assert.equal(body.failed, 0, JSON.stringify(body));
  const toAccountant = mails.filter((m) => JSON.stringify(m.to).includes("boekhouder@example.invalid"));
  assert.equal(toAccountant.length, 1);
  assert.doesNotMatch(toAccountant[0].html, /Nog niet compleet/);
});

test("[PACKAGE-FAIL-CLOSED] quarter cron: when a source cannot be read, no one is told the quarter is ready", async () => {
  for (const [name, failures] of [
    ["unplaced bank lines ({ error })", [failRead("unresolved_bank_lines", "error")]],
    ["unplaced bank lines (thrown)", [failRead("unresolved_bank_lines", "throw")]],
    ["bank costs without invoice ({ error })", [failRead("bank_cost_lines", "error")]],
    ["the bank coverage probe ({ error })", [failRead("bank_coverage", "error")]],
    ["the statement files ({ error })", [failRead("bank_statement_files", "error")]],
    ["the quarter's invoices ({ error })", [failRead("invoices", "error")]],
  ] as [string, Failure[]][]) {
    scenario({ user: null, tables: tidyQuarter(), failures });
    const { GET } = await cron();
    const body = await (await quiet(() => GET(cronRequest()))).json();
    assert.equal(body.failed, 1, `${name}: the owner counts as failed, so the run is not ok (${JSON.stringify(body)})`);
    assert.equal(body.notifiedAccountants, 0, `${name}`);
    assert.equal(mails.length, 0, `${name}: no "staat klaar" mail over a quarter that was not read`);
    assert.equal(writesTo("notifications").length, 0, `${name}: nor an in-app one, to anybody`);
  }
});

/** What the run wrote on its heartbeat when it finished — the row /api/health judges it by. */
function heartbeat(): Row {
  const finish = writesTo("cron_runs").filter((q) => q.write === "update");
  assert.equal(finish.length, 1, "the run closed its heartbeat exactly once");
  return finish[0].payload as Row;
}

test("[PACKAGE-FAIL-CLOSED] quarter cron: a run with a failed owner says so — in its answer AND in its heartbeat", async () => {
  scenario({ user: null, tables: tidyQuarter(), failures: [failRead("unresolved_bank_lines", "error")] });
  const { GET } = await cron();
  const body = await (await quiet(() => GET(cronRequest()))).json();
  assert.equal(body.failed, 1, JSON.stringify(body));
  assert.equal(body.ok, false, "the response may not call a run with a failed owner ok");
  const beat = heartbeat();
  assert.equal(beat.ok, false, "nor may the heartbeat");
  assert.equal((beat.result as Row).ok, false);
  assert.match(String(beat.error ?? ""), /1 .*owner/i, "the heartbeat says what went wrong");
  // …and the rule this PR exists for still holds: nothing announced the quarter.
  assert.equal(mails.length, 0);
});

test("[PACKAGE-FAIL-CLOSED] quarter cron: a run cut short by its deadline is not ok either", async () => {
  // Two owners; the clock passes the soft deadline once the first one has been served.
  const t = tidyQuarter();
  t.profiles.push({ id: OWNER2, role: "zzper", email: "tweede@example.invalid", company_name: "Tweede Zaak", full_name: "Tom Tweede", kor_active: false, vat_scheme: "factuur" });
  const realNow = Date.now;
  let skew = 0;
  Date.now = () => realNow() + skew;
  try {
    scenario({
      user: null, tables: t,
      onQuery: (q) => { if (q.table === "notifications" && q.write === "insert") skew = 300_000; },
    });
    const { GET } = await cron();
    const body = await (await quiet(() => GET(cronRequest()))).json();
    assert.equal(body.failed, 0, JSON.stringify(body));
    assert.equal(body.truncated, 1, "the second owner was never reached");
    assert.equal(body.ok, false, "a run that did not reach every owner is not ok");
    const beat = heartbeat();
    assert.equal(beat.ok, false, "and the heartbeat may not say it was");
    assert.match(String(beat.error ?? ""), /1 .*not reached|deadline/i, "the heartbeat says why");
  } finally {
    Date.now = realNow;
  }
});

test("[PACKAGE-FAIL-CLOSED] quarter cron: a complete run is ok in both places", async () => {
  scenario({ user: null, tables: tidyQuarter() });
  const { GET } = await cron();
  const body = await (await quiet(() => GET(cronRequest()))).json();
  assert.equal(body.ok, true, JSON.stringify(body));
  assert.equal(heartbeat().ok, true);
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Door 4 — /api/closing-package/share: the owner mails a link to an accountant without an account
// ════════════════════════════════════════════════════════════════════════════════════════════════

const share = () => import("../../src/app/api/closing-package/share/route");
const shareRequest = () =>
  new NextRequest("http://localhost/api/closing-package/share", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ year: YEAR, quarter: QUARTER, email: "kantoor@example.invalid" }),
  });

test("[PACKAGE-FAIL-CLOSED] share mail, healthy: the link goes out with the counts the package holds", async () => {
  scenario({ user: OWNER });
  const { POST } = await share();
  const res = await quiet(() => POST(shareRequest()));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  assert.equal(mails.length, 1);
  // The count, not the noun: the template's plural ("verkoopfactuuren") is its own, separate matter.
  assert.match(mails[0].html, /<strong>3 verkoopfact\w*<\/strong>/);
  assert.match(mails[0].html, /<strong>3 inkoopfact\w*<\/strong>/);
  assert.equal(writesTo("package_shares").filter((q) => q.write === "insert").length, 1);
  assert.deepEqual(auditActions(), ["package.link_shared"]);
});

test("[PACKAGE-FAIL-CLOSED] share mail: an unreadable source sends nothing and leaves no live link", async () => {
  for (const [name, failures] of [
    ["the quarter's invoices ({ error })", [failRead("invoices", "error")]],
    ["the quarter's invoices (thrown)", [failRead("invoices", "throw")]],
    ["unplaced bank lines ({ error })", [failRead("unresolved_bank_lines", "error")]],
    ["the statement files (thrown)", [failRead("bank_statement_files", "throw")]],
  ] as [string, Failure[]][]) {
    scenario({ user: OWNER, failures });
    const { POST } = await share();
    const res = await quiet(() => POST(shareRequest()));
    assert.equal(res.status, 503, `${name}: ${JSON.stringify(await res.clone().json())}`);
    assert.ok(Number(res.headers.get("retry-after")) > 0, name);
    assert.equal(mails.length, 0, `${name}: no mail — "0 verkoopfacturen" is a claim about the quarter, not a placeholder`);
    const inserted = writesTo("package_shares").filter((q) => q.write === "insert").length;
    const revoked = writesTo("package_shares").filter((q) => q.write === "update" && (q.payload as Row).revoked_at).length;
    assert.equal(inserted - revoked, 0, `${name}: no share link is left live`);
    assert.deepEqual(auditActions(), [], `${name}: nothing was shared`);
  }
});
