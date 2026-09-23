// src/lib/closing-package-sources.test.ts
// [PACKAGE-FAIL-CLOSED] Run: npx tsx --test src/lib/closing-package-sources.test.ts
//
// "Failed financial read ≠ empty financial period." The quarter package is built here against a
// fake PostgREST that holds one ordinary quarter (tests/support/package-quarter.ts), and every read
// the package cannot be honest without is failed on its own — as a `{ error }` response and as a
// thrown await, and for paged reads on the second page only. Each must refuse the package with the
// source named; none may produce a ZIP. Then the other half: the same quarter read in full, and a
// quarter that genuinely holds nothing, still produce their package — with the same figures the
// package had before this change.
//
// The doors that deliver the package (and the cron and mail that announce it) are exercised in
// tests/render/package-doors.test.tsx; this file is about the builder and the summary themselves.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import ts from "typescript";
import {
  buildClosingPackageZip,
  summarizeClosingPackage,
  ClosingPackageSourceUnavailableError,
} from "./closing-package";
import { makeFakeDb, type Failure, type Row, type StorageFailure } from "../../tests/support/package-fake-db";
import { SOURCE_READS, failRead, failSecondPage, type SourceName } from "../../tests/support/package-sources";
import {
  OWNER, YEAR, QUARTER, PATHS,
  quarterTables, quarterStorage, emptyQuarterTables, withManyCardPayouts,
} from "../../tests/support/package-quarter";

// ── Helpers ────────────────────────────────────────────────────────────────────────────────────

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const e = console.error, w = console.warn;
  console.error = () => {}; console.warn = () => {};
  try { return await fn(); } finally { console.error = e; console.warn = w; }
};

function client(opts: { tables?: Record<string, Row[]>; failures?: Failure[]; storageFailures?: StorageFailure[] } = {}) {
  return makeFakeDb(opts.tables ?? quarterTables(), {
    failures: opts.failures, storage: quarterStorage(), storageFailures: opts.storageFailures,
  });
}

function build(opts: Parameters<typeof client>[0] = {}) {
  const db = client(opts);
  return quiet(() => buildClosingPackageZip({ ownerId: OWNER, year: YEAR, quarter: QUARTER, supabase: db.client as never }));
}

function summarize(opts: Parameters<typeof client>[0] = {}) {
  const db = client(opts);
  return quiet(() => summarizeClosingPackage({ ownerId: OWNER, year: YEAR, quarter: QUARTER, supabase: db.client as never }));
}

async function refusal(p: Promise<unknown>): Promise<ClosingPackageSourceUnavailableError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof ClosingPackageSourceUnavailableError, `expected the typed refusal, got ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
    return e;
  }
  assert.fail("a package was built over a source that could not be read");
}

async function files(zipBytes: Buffer): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(zipBytes);
  const out: Record<string, string> = {};
  for (const [name, f] of Object.entries(zip.files)) {
    if (!f.dir) out[name] = /\.(csv|txt|json)$/.test(name) ? await f.async("string") : "<binary>";
  }
  return out;
}

// Every read the builder must not survive, with the scenario in which it is actually made.
const REQUIRED_BY_BUILDER: SourceName[] = [
  "invoices", "purchase_evidence", "bank_statement_files", "bank_coverage", "bank_transactions",
  "bank_cost_lines", "excluded_bank_lines", "pos_income", "cash_turnover", "cash_entries",
  "kasboek_entries", "daily_turnover", "kasboek_turnover", "eft_settlements", "pin_ledger", "kor",
  "kas_opening_balance", "vat_exemption", "vat_scheme", "rate_split", "regime_lines", "vat_clawback",
  "bad_debt", "supplier_countries", "bank_statement_periods",
];

// ── 1. A required source that cannot be read: no package, and the source is named ──────────────

test("[PACKAGE-FAIL-CLOSED] every required source: a failed read refuses the package, in both failure shapes", async () => {
  for (const name of REQUIRED_BY_BUILDER) {
    for (const mode of ["error", "throw"] as const) {
      const e = await refusal(build({ failures: [failRead(name, mode)] }));
      assert.equal(e.source, name, `${name} (${mode}): the refusal names the source that failed`);
      assert.equal(e.name, "ClosingPackageSourceUnavailableError");
    }
  }
});

test("[PACKAGE-FAIL-CLOSED] page one arriving is not the read succeeding: a failure on page two refuses too", async () => {
  // 1001 extra card payouts: the payout read and the quarter's bank read both need a second page.
  for (const name of ["pos_income", "bank_transactions"] as const) {
    for (const mode of ["error", "throw"] as const) {
      const e = await refusal(build({ tables: withManyCardPayouts(quarterTables(), 1001), failures: [failSecondPage(name, mode)] }));
      assert.equal(e.source, name, `${name} page two (${mode})`);
    }
  }
  // …and with both pages readable, every row counts: 150 on the day itself plus 1001 × €1.
  const { zipBytes } = await build({ tables: withManyCardPayouts(quarterTables(), 1001) });
  const dag = (await files(zipBytes))["dagomzet.csv"];
  assert.match(dag, /^2026-02-02;150,00;1151,00;1001,00;/m, "both pages of payouts reached the reconciliation");
});

test("[PACKAGE-FAIL-CLOSED] evidence: Storage being unavailable refuses; a file that is simply not there stays a named gap", async () => {
  for (const f of [
    { path: PATHS.purchase1, mode: "error" as const, status: 503 },
    { path: PATHS.purchase1, mode: "error" as const, status: 429 },
    { path: PATHS.statement, mode: "throw" as const },
  ]) {
    const e = await refusal(build({ storageFailures: [f] }));
    assert.equal(e.source, "evidence_files", JSON.stringify(f));
  }
  // Storage answering about the key itself: the evidence is missing, and the package says which.
  const { zipBytes, summary } = await build({
    storageFailures: [{ path: PATHS.purchase1, mode: "error", status: 400, message: "Object not found" }],
  });
  assert.ok(summary.warnings.some((w) => w.code === "pdf_missing" && /LEV-1/.test(w.message)));
  assert.ok(!Object.keys(await files(zipBytes)).some((n) => /LEV-1\.pdf$/.test(n)));
});

// ── 2. Everything read: the package, with the figures it always had ────────────────────────────

test("[PACKAGE-FAIL-CLOSED] the healthy quarter: a package, every source in it, and the figures unchanged", async () => {
  const { zipBytes, summary } = await build();
  const f = await files(zipBytes);
  assert.deepEqual(summary.unreadSources, []);
  // The concept aangifte from every source at once — the same lines this quarter produced before
  // fail-closed existed: on a healthy quarter nothing about the figures has changed.
  const concept = f["concept-btw-aangifte.csv"];
  for (const line of [
    "1a;Leveringen/diensten belast met hoog tarief (21%);1200,00;252,00",
    "1b;Leveringen/diensten belast met laag tarief (9%);900,00;81,00",
    "4b;Leveringen/diensten uit landen binnen de EU;400,00;84,00",
    "5a;Verschuldigde omzetbelasting;;417,00",
    "5b;Voorbelasting;;151,00",
    "5g;Concept te betalen;;266,00",
  ]) assert.ok(concept.split("\n").some((l) => l.trim() === line), `concept line: ${line}`);
  // Every class of source left its mark.
  for (const file of ["bankafschrift/afschrift-q1.pdf", "dagomzet.csv", "kaart-reconciliatie.csv", "bankafletering.csv", "Kasboek-Q1-2026.xlsx", "inkopen-buitenland.csv"]) {
    assert.ok(file in f, `${file} is in the package`);
  }
  const codes = summary.warnings.map((w) => w.code);
  for (const code of ["bank_cost_without_invoice", "bank_coverage_incomplete", "regime_margin_scheme", "vat_clawback_art29_7", "bad_debt_art29_1"]) {
    assert.ok(codes.includes(code), `the warning ${code} that its source decides is there`);
  }
  for (const gone of ["cash_read_failed", "bank_read_failed", "turnover_read_failed", "kasboek_unavailable"]) {
    assert.ok(!codes.includes(gone), `${gone} is no longer a state a package can be in`);
  }
});

test("[PACKAGE-FAIL-CLOSED] a quarter that genuinely holds nothing is read, not refused", async () => {
  const { zipBytes, summary } = await build({ tables: emptyQuarterTables() });
  const f = await files(zipBytes);
  assert.deepEqual(summary.unreadSources, []);
  assert.ok("overzicht.csv" in f);
  assert.ok(!("concept-btw-aangifte.csv" in f), "nothing declarable, so no invented concept");
  assert.ok(summary.warnings.some((w) => w.code === "bank_missing"), "zero bank lines READ is a fact the package may state");
  // One empty source inside an otherwise full quarter is the same: no terminal settlements, no
  // grootboek, no statement periods — read, and empty.
  const t = quarterTables();
  t.eft_settlements = []; t.ledger_daily = []; t.bank_statement_periods = []; t.suppliers = [];
  const partial = await build({ tables: t });
  assert.deepEqual(partial.summary.unreadSources, []);
  assert.ok("kaart-reconciliatie.csv" in (await files(partial.zipBytes)));
});

// ── 3. The summary: it cannot throw (readiness shares it), so it names what it could not read ──

test("[PACKAGE-FAIL-CLOSED] summary: an unread source is named, and the warning it decides is not guessed", async () => {
  const healthy = await summarize();
  assert.deepEqual(healthy.unreadSources, []);
  assert.ok(healthy.warnings.some((w) => w.code === "bank_unresolved"));
  assert.ok(healthy.warnings.some((w) => w.code === "bank_cost_without_invoice"));

  for (const [name, decides] of [
    ["unresolved_bank_lines", "bank_unresolved"],
    ["bank_cost_lines", "bank_cost_without_invoice"],
    ["bank_coverage", "no_bank_statement"],
    ["bank_statement_files", "bank_file_missing"],
  ] as const) {
    for (const mode of ["error", "throw"] as const) {
      const s = await summarize({ failures: [failRead(name, mode)] });
      assert.deepEqual(s.unreadSources, [name], `${name} (${mode}) is named`);
      assert.ok(!s.warnings.some((w) => w.code === decides),
        `${name} (${mode}): ${decides} is not reported from a source that was not read`);
      // The two false claims the old code made about an unread bank: "none found", "file missing".
      assert.ok(!s.warnings.some((w) => w.code === "no_bank_statement"), `${name} (${mode}): no "geen banktransacties" guessed`);
      assert.ok(!s.warnings.some((w) => w.code === "bank_file_missing"), `${name} (${mode}): no "bestand ontbreekt" guessed`);
    }
  }
  // Without the invoices there is no summary at all — readiness answers that with a 503.
  const e = await refusal(summarize({ failures: [failRead("invoices", "error")] }));
  assert.equal(e.source, "invoices");
});

/** A payout that states its own commission, and no terminal settlement: the sentence says "booked". */
function withStatedCommission(): Record<string, Row[]> {
  const t = quarterTables();
  t.eft_settlements = [];
  Object.assign(t.bank_transactions.find((b) => b.id === "bt-005")!, {
    description: "AFREK. BETAALAUTOMAAT VISA REFNR. F9Q3BH DAT. 20260302/1 AANT. 2 BRUTO 12200 /COM D100",
  });
  return t;
}

test("[PACKAGE-FAIL-CLOSED] summary: the commission sentence is left out, not guessed, when its reads fail", async () => {
  const healthy = await summarize({ tables: withStatedCommission() });
  assert.equal(healthy.cardStatedCommission?.booked, true, "the fixture states a booked commission");
  for (const name of ["pos_income", "eft_presence"] as const) {
    for (const mode of ["error", "throw"] as const) {
      const s = await summarize({ tables: withStatedCommission(), failures: [failRead(name, mode)] });
      assert.equal(s.cardStatedCommission, null, `${name} (${mode}): no sentence built on a read that failed`);
      // A finding, never a gate: it does not cost the owner the quarter's notice.
      assert.deepEqual(s.unreadSources, [], `${name} (${mode})`);
    }
  }
});

// ── 4. The rule, held against the code rather than against a comment ──────────────────────────

/** The source with its comments removed by the TypeScript printer, so a comment can never satisfy a check. */
function codeOf(path: string): string {
  const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return ts.createPrinter({ removeComments: true }).printFile(sf);
}

test("[PACKAGE-FAIL-CLOSED] no read in the builder is swallowed into an empty list again, and every named source is tested", () => {
  const src = codeOf("src/lib/closing-package.ts");
  const start = src.indexOf("export async function buildClosingPackageZip(");
  assert.ok(start > 0, "the builder was found in the code (not in a comment)");
  const builder = src.slice(start);
  // The shapes that turned an outage into "no rows": gone from the builder, in any spelling.
  assert.doesNotMatch(builder, /\.catch\(\(\) => \[\]\)/, "a read in the builder is swallowed into [] again");
  assert.doesNotMatch(builder, /\.catch\(\(\) => null\)/, "a read in the builder is swallowed into null again");
  assert.doesNotMatch(builder, /(cash|bank|kasboek)ReadFailed/, "a degraded half-package is being assembled again");

  // Every source the code names is one this file fails on purpose — a new required read without a
  // failure test is how the next silent path would arrive.
  const named = new Set(
    [...src.matchAll(/(?:required|requiredResponse|attempt)\("([a-z_]+)"|ClosingPackageSourceUnavailableError\("([a-z_]+)"/g)]
      .map((m) => m[1] ?? m[2]),
  );
  const tested = new Set<string>([...REQUIRED_BY_BUILDER, "unresolved_bank_lines", "evidence_files"]);
  for (const n of named) assert.ok(tested.has(n), `the source "${n}" is required in code but no test fails it`);
  for (const n of REQUIRED_BY_BUILDER) assert.ok(n in SOURCE_READS, n);
});
