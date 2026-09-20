// src/lib/privilege-gates.test.ts
// [PRIVILEGE-REGISTRY] The repo-level gates around scripts/privilege-registry.ts, and the mutation
// tests that prove they bite.
//
// What this file can and cannot promise, stated once so nobody reads it as more than it is:
//
//   · It reads migration TEXT and the registry. It can require that every function a migration
//     creates has a registry row, that a NEW identity decides all four default grant paths, that
//     an explicit GRANT/REVOKE does not contradict a decided intent, that the registry is
//     internally consistent, and that the two generated artefacts are current.
//   · It cannot see the database. CREATE OR REPLACE keeps an old ACL, a migration applied through
//     the MCP path has no file here, and privilege SQL built at run time is a string until it
//     runs — the reader marks that UNPROVEN rather than correct. tests/sql/privilege-check.sql
//     (real PostgreSQL) and docs/PRIVILEGE_ORACLE.sql (production catalog) are the oracles.
//     This file is the early warning, not the oracle.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  ACKNOWLEDGED_PRODUCTION_MIGRATIONS, EXPECTED_FUNCTION_DEFAULT_ACL, GRANTEES, IS_MY_ACCOUNTANT_CLIENT_HARDENING_INVARIANT,
  PLATFORM_CLASSES, REGISTRY, acceptedDeviationCount, liveEntries, nameOf, unknownCount, type FunctionEntry,
} from "../../scripts/privilege-registry";
import {
  INTENT_SQL_PATH, MIGRATIONS_DIR, ORACLE_SQL_PATH,
  checkMigration, finalDecisions, functionsCreatedBy, functionsDroppedBy, grantPathsHandled, identityTypeOfArgument,
  indexMigrations, isExistingIdentity, migrationFiles, normaliseType, readPrivilegeStatements, renderIntentSql,
  renderOracleSql, splitStatements, stripSql, type MigrationFinding,
} from "../../scripts/privilege-oracle";

const index = indexMigrations();
const files = migrationFiles();
const read = (f: string) => readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8");

// ── The grandfather list: migrations that predate the four-path rule ───────────────────────────
//
// Frozen. A file here is only required to have its functions registered and its privilege SQL
// provable; a contradiction it carries is HISTORICAL (a later file superseded it) and is pinned
// below rather than enforced. A file NOT on this list that creates a `public` function must
// decide PUBLIC, anon, authenticated and service_role for every NEW identity, and every
// GRANT/REVOKE it contains must agree with the registry. The list may shrink; the ratchet below
// forbids it from growing, because growing it is how a rule quietly stops applying.
const GRANDFATHERED = new Set([
  "account_purpose_archief.sql", "accountant_amount_guard_restore.sql", "accountant_confirm_mandate.sql",
  "accountant_discount_guard.sql", "accountant_invoice_mandate.sql", "accountant_vat_deduction_guard.sql",
  "accountant_write_guard_fix.sql", "accountant_write_holes.sql", "ai_budget_settle.sql", "ai_spend_guard.sql",
  "allocate_bank_payment.sql", "audit_logs_client_read.sql", "bank_confirm_atomic.sql", "bank_connections_updated_at.sql",
  "bank_rpc_never_payable_states.sql", "billing_subscription.sql", "book_bank_batch_atomic.sql", "bookkeeping_date_sane.sql",
  "company_members_sales_role.sql", "creditnota_partial.sql", "creditnota_per_rate_ceiling.sql",
  "documents_content_hash_unique.sql", "factuur_b_numbering.sql", "fair_use_usage.sql", "invoice_accountant_attribution.sql",
  "invoice_accountant_write_guard.sql", "invoice_manual_payment_idempotency_scope.sql", "invoice_manual_payments.sql",
  "invoice_move_payment.sql", "invoice_move_payment_creditnota_guard.sql", "invoice_number_twins.sql",
  "invoice_paid_requires_allocation.sql", "invoice_partial_payments.sql", "invoice_payment_date_rederive.sql",
  "ontvangen_fair_use_per_document.sql", "paid_invoice_money_frozen.sql", "plan_grants.sql", "profile_vak.sql",
  "register_profile_from_metadata.sql", "search_smart.sql", "seed_invoice_counter.sql", "vat_exemption.sql",
  "verwerkt_freeze_level.sql", "work_done_counts.sql",
]);
const GRANDFATHERED_CEILING = 44;

const allFindings: MigrationFinding[] = files.flatMap((f) =>
  checkMigration(f, read(f), REGISTRY, { grandfathered: GRANDFATHERED.has(f) }));
const findingsOf = (problem: MigrationFinding["problem"]) => allFindings.filter((x) => x.problem === problem);
const describe = (x: MigrationFinding) =>
  `${x.file}: ${x.fn ?? x.signature ?? ""}${x.role ? " " + x.role : ""}${x.missing ? " does not decide " + x.missing.join(", ") : ""}${x.detail ? " — " + x.detail : ""}`;

test("[PRIVILEGE-REGISTRY] the grandfather list is a ratchet: it may shrink, never grow", () => {
  assert.ok(GRANDFATHERED.size <= GRANDFATHERED_CEILING,
    `the grandfather list grew to ${GRANDFATHERED.size}; a new function-creating migration must decide all four grant paths instead`);
  for (const f of GRANDFATHERED) assert.ok(files.includes(f), `${f} is grandfathered but no longer on disk — remove it from the list`);
});

// ── Gate 1: registration, the four paths for new identities, and direction ────────────────────

test("[PRIVILEGE-REGISTRY] every public function a migration creates or replaces has a registry row", () => {
  assert.deepEqual(findingsOf("no_registry_entry").map(describe), [],
    "these functions are created by a migration but have no row in scripts/privilege-registry.ts — " +
    "a function nobody has decided about is the shape that let the refund writers stay open");
});

test("[PRIVILEGE-REGISTRY] a NEW identity outside the grandfather list decides all four default grant paths", () => {
  assert.deepEqual(findingsOf("default_paths_not_handled").map(describe), [],
    "Supabase grants anon, authenticated and service_role BY NAME on every new function, and the built-in default " +
    "grants PUBLIC. A REVOKE FROM PUBLIC alone leaves the three named grants standing. A new function's migration " +
    "must end with an explicit decision for all four (a body-only CREATE OR REPLACE of a LIVE function owes none). " +
    "Text check, early warning only: the SQL seam and docs/PRIVILEGE_ORACLE.sql ask the catalog.");
});

test("[PRIVILEGE-REGISTRY] no migration outside the grandfather list contradicts a decided registry intent", () => {
  assert.deepEqual(findingsOf("contradicts_intent").map(describe), [],
    "a final explicit GRANT where the registry says DENY, or a final REVOKE where it says ALLOW. " +
    "Change the registry decision first, in scripts/privilege-registry.ts, where the reason is written — never here");
  assert.deepEqual(findingsOf("privilege_on_unregistered_function").map(describe), [],
    "a GRANT/REVOKE on a function the registry does not know");
});

test("[PRIVILEGE-REGISTRY] privilege SQL the reader cannot prove is never called correct", () => {
  assert.deepEqual(findingsOf("unproven_privilege_sql").map(describe), [],
    "a role or function built at run time, or a wildcard over every function: the text gate cannot judge it, " +
    "so write the GRANT/REVOKE by signature, or prove it in the SQL seam");
});

test("[PRIVILEGE-REGISTRY] the historical contradictions in grandfathered files are pinned, not enforced", () => {
  // Each of these is a GRANT that a LATER migration revokes again (rpc_anon_revoke.sql revokes
  // authenticated from seed_invoice_counter and recompute_invoice_amount_paid). A per-file reading
  // cannot see the later file, so it is recorded here as history and the catalog judges reality.
  // The list may shrink when an old file is brought in line; a new entry means a grandfathered
  // file was edited to say something the registry refuses.
  assert.deepEqual(findingsOf("historical_contradiction").map(describe).sort(), [
    "invoice_partial_payments.sql: recompute_invoice_amount_paid authenticated — final explicit GRANT but registry intent is DENY",
    "invoice_payment_date_rederive.sql: recompute_invoice_amount_paid authenticated — final explicit GRANT but registry intent is DENY",
    "seed_invoice_counter.sql: seed_invoice_counter authenticated — final explicit GRANT but registry intent is DENY",
  ]);
  for (const x of findingsOf("historical_contradiction")) assert.ok(GRANDFATHERED.has(x.file), `${x.file} is not grandfathered`);
});

test("[PRIVILEGE-REGISTRY] an explicit decision on an UNKNOWN intent is reported, never failed and never invented", () => {
  // rpc_anon_revoke.sql grants service_role on two trigger functions whose service_role intent is
  // UNKNOWN. The gate says so; it does not turn UNKNOWN into ALLOW to make the row green.
  const touched = findingsOf("unknown_intent_touched").map(describe).sort();
  assert.deepEqual(touched, [
    "rpc_anon_revoke.sql: assert_credit_within_original serviceRole — GRANT while intent is UNKNOWN",
    "rpc_anon_revoke.sql: handle_new_user serviceRole — GRANT while intent is UNKNOWN",
  ]);
});

// ── Gate 2: the registry is internally consistent ─────────────────────────────────────────────

test("[PRIVILEGE-REGISTRY] signatures are unique, normalised, and every value is one of the three", () => {
  const seen = new Set<string>();
  for (const e of REGISTRY) {
    assert.match(e.signature, /^public\.[a-z0-9_]+\((|[a-z0-9_ \[\]]+(, [a-z0-9_ \[\]]+)*)\)$/,
      `${e.signature}: not the type-only identity form PostgreSQL prints (public.name(type, type))`);
    assert.ok(!/\bint\b|\bbool\b|\btimestamptz\b|\bvarchar\b/.test(e.signature), `${e.signature}: use PostgreSQL's spelling (integer, boolean, …)`);
    assert.ok(!seen.has(e.signature), `${e.signature} appears twice`);
    seen.add(e.signature);
    for (const g of GRANTEES) assert.ok(["ALLOW", "DENY", "UNKNOWN"].includes(e.intent[g]), `${e.signature} ${g}: ${e.intent[g]}`);
    assert.equal(e.managedBy, "boekbrug");
    assert.equal(e.owner, "postgres");
    assert.ok(e.evidence.length > 0, `${e.signature}: no evidence`);
    assert.ok(e.callers.length > 0, `${e.signature}: callers not stated (say 'none found' if so)`);
    if (e.status === "live") {
      assert.ok(e.current, `${e.signature}: a live function must carry its measured privileges`);
      assert.ok(e.verified, `${e.signature}: a live function must say when and where it was measured`);
      assert.match(e.current!.aclMd5, /^[0-9a-f]{32}$/);
    } else {
      // planned / not_in_production: nothing has been measured, and the row must not pretend otherwise.
      assert.equal(e.current, null, `${e.signature}: a ${e.status} function has no measured privileges`);
      assert.equal(e.verified, null, `${e.signature}: a ${e.status} function has not been verified`);
      assert.equal(e.provenance.inRepo, true, `${e.signature}: a ${e.status} function can only come from a repo migration`);
      assert.equal(e.acceptedDeviations, undefined, `${e.signature}: a deviation needs a measured reality to deviate from`);
    }
    // A deviation is only meaningful where reality differs from a DECISION.
    for (const [g, reason] of Object.entries(e.acceptedDeviations ?? {})) {
      const grantee = g as (typeof GRANTEES)[number];
      assert.notEqual(e.intent[grantee], "UNKNOWN", `${e.signature} ${g}: an accepted deviation on an UNKNOWN intent is meaningless`);
      assert.ok(reason.length > 10, `${e.signature} ${g}: a deviation needs its reason`);
      const actual = grantee === "public" ? e.current!.publicEntry : e.current![grantee];
      assert.notEqual((e.intent[grantee] === "ALLOW"), actual,
        `${e.signature} ${g}: accepted deviation recorded, but the measured value already equals the intent — stale`);
    }
  }
});

test("[PRIVILEGE-REGISTRY] a measured value that differs from a decision is either an accepted deviation or a known open finding", () => {
  // Reality ≠ intent, nothing recorded: that is the row the oracle would print as DRIFT today. The
  // registry must not ship with silent DRIFT against its own baseline — every such row is either
  // accepted (with a reason) or the intent is UNKNOWN.
  const silent: string[] = [];
  for (const e of liveEntries()) {
    for (const g of GRANTEES) {
      if (e.intent[g] === "UNKNOWN") continue;
      const actual = g === "public" ? e.current!.publicEntry : e.current![g];
      if ((e.intent[g] === "ALLOW") !== actual && !e.acceptedDeviations?.[g]) silent.push(`${e.signature} ${g}`);
    }
  }
  assert.deepEqual(silent, []);
});

test("[PRIVILEGE-REGISTRY] provenance matches the migrations directory", () => {
  for (const e of REGISTRY) {
    const name = nameOf(e.signature);
    const creators = index.createdIn.get(name) ?? [];
    if (e.provenance.inRepo) {
      assert.ok(creators.length > 0, `${e.signature}: provenance says a repo migration creates it, but none does`);
    } else {
      assert.equal(creators.length, 0, `${e.signature}: provenance says no repo file, but ${creators.join(", ")} creates it`);
      assert.ok(e.provenance.note || e.provenance.productionVersions.length > 0,
        `${e.signature}: a function with no repo source must say where it came from`);
      for (const v of e.provenance.productionVersions) {
        assert.ok(ACKNOWLEDGED_PRODUCTION_MIGRATIONS.some((a) => a.version === v && a.functions.includes(name)),
          `${e.signature}: production version ${v} is not acknowledged for this function`);
      }
    }
  }
  // …and the other way: every acknowledged repo file exists.
  for (const a of ACKNOWLEDGED_PRODUCTION_MIGRATIONS) {
    assert.match(a.version, /^\d{14}$/, `${a.name}: version is not a 14-digit timestamp`);
    if (a.repoFile) assert.ok(existsSync(`${MIGRATIONS_DIR}/${a.repoFile}`), `${a.name}: acknowledged repo file ${a.repoFile} does not exist`);
    assert.ok(a.reason.length > 10, `${a.name}: an acknowledgement needs its reason`);
  }
});

test("[PRIVILEGE-REGISTRY] the settled decisions stay settled", () => {
  // The owner ruled on these by name. A change is a decision, and this pins it as one.
  const by = (sig: string): FunctionEntry => {
    const e = REGISTRY.find((x) => x.signature === sig);
    assert.ok(e, `${sig} missing from the registry`);
    return e!;
  };
  assert.deepEqual(by("public.cleanup_old_rate_limits()").intent, { anon: "DENY", authenticated: "DENY", serviceRole: "ALLOW", public: "DENY" });
  assert.deepEqual(by("public.reverse_invoice_payment(uuid, uuid)").intent, { anon: "DENY", authenticated: "ALLOW", serviceRole: "ALLOW", public: "DENY" });
  // [PRIVILEGE-BEWIJS] authenticated resolved to DENY by the 2026-09-20 evidence pass: the creation
  // migration granted service_role only; the only known caller (PR #344) runs as service_role.
  const answer = by("public.answer_mollie_refund(uuid, text, text, numeric)");
  assert.deepEqual(answer.intent, { anon: "DENY", authenticated: "DENY", serviceRole: "ALLOW", public: "DENY" });
  assert.ok(answer.acceptedDeviations?.authenticated, "authenticated still has EXECUTE in production; that must be recorded, not hidden, until a separate hardening step");
  assert.deepEqual(by("public.mollie_refund_reason_of(text)").intent, { anon: "DENY", authenticated: "DENY", serviceRole: "ALLOW", public: "DENY" });
  for (const t of ["clients", "documents", "folders", "invoices"]) {
    const e = by(`public.search_${t}_fuzzy(text)`);
    assert.equal(e.intent.anon, "DENY");
    assert.equal(e.intent.authenticated, "ALLOW");
    assert.equal(e.intent.serviceRole, "ALLOW");
  }
  // [PRIVILEGE-BEWIJS] acting_for_owner: anon and PUBLIC resolved to DENY. Every policy that calls
  // it is TO authenticated (live catalog and the 1 September snapshot), so anon never evaluates it.
  // The two are NOT the same case: is_my_accountant_client DOES sit in TO public policies.
  const acting = by("public.acting_for_owner()");
  assert.deepEqual(acting.intent, { anon: "DENY", authenticated: "ALLOW", serviceRole: "ALLOW", public: "DENY" });
  assert.ok(acting.acceptedDeviations?.anon && acting.acceptedDeviations?.public,
    "anon and PUBLIC still have EXECUTE in production; recorded as deviations until a separate hardening step");
  const client = by("public.is_my_accountant_client(uuid)");
  assert.equal(client.intent.anon, "ALLOW", "five policies are TO public; revoking anon broke production once");
  // [PRIVILEGE-BEWIJS] batch 2: PUBLIC resolved to DENY. Effective anon EXECUTE is required; the
  // PUBLIC entry is not what provides it (the named grants are). The revoke is a later, bound step.
  assert.deepEqual(client.intent, { anon: "ALLOW", authenticated: "ALLOW", serviceRole: "ALLOW", public: "DENY" });
  assert.ok(client.acceptedDeviations?.public, "the PUBLIC entry is still there in production; recorded, not hidden");
  assert.ok(client.evidence.includes(IS_MY_ACCOUNTANT_CLIENT_HARDENING_INVARIANT),
    "the hardening invariant (assert the named grants explicitly when PUBLIC is revoked) must travel with the row");
  assert.match(IS_MY_ACCOUNTANT_CLIENT_HARDENING_INVARIANT, /named EXECUTE grants .* must be asserted explicitly/);
  assert.match(IS_MY_ACCOUNTANT_CLIENT_HARDENING_INVARIANT, /must not be assumed from default privileges/);
  // The invariant must not overstate the evidence: only anon and authenticated evaluate the RLS
  // paths; service_role bypasses RLS and is kept ALLOW as the compatibility boundary, not for RLS.
  assert.match(IS_MY_ACCOUNTANT_CLIENT_HARDENING_INVARIANT, /anon and authenticated because the RLS policy paths/);
  assert.match(IS_MY_ACCOUNTANT_CLIENT_HARDENING_INVARIANT, /service_role because it remains explicitly ALLOW .* not because of RLS/);
  // [PRIVILEGE-BEWIJS] batch 2: the accountant-status door trigger is fully decided: DENY for every
  // role, all four current grants recorded as inert deviations. Written explicitly, not via the
  // trigger helper, so the other trigger rows keep their undecided service_role/PUBLIC.
  const door = by("public.accountant_status_door_only()");
  assert.equal(door.kind, "trigger");
  assert.deepEqual(door.intent, { anon: "DENY", authenticated: "DENY", serviceRole: "DENY", public: "DENY" });
  assert.deepEqual(Object.keys(door.acceptedDeviations ?? {}).sort(), ["anon", "authenticated", "public", "serviceRole"]);
  // [PRIVILEGE-BEWIJS] batch 2: grant_welcome_plus is obsolete / no live caller found: production
  // dropped its trigger on 17 September and nothing references it. Kept, not dropped.
  const welcome = by("public.grant_welcome_plus()");
  assert.equal(welcome.kind, "obsolete");
  assert.deepEqual(welcome.intent, { anon: "DENY", authenticated: "DENY", serviceRole: "DENY", public: "DENY" });
  assert.deepEqual(Object.keys(welcome.acceptedDeviations ?? {}).sort(), ["anon", "authenticated", "public", "serviceRole"]);
  // [PRIVILEGE-BEWIJS] get_accountant_for_zzper: obsolete / no live caller found. DENY for every
  // role is the boundary; the four current ALLOWs are legacy default exposure, each recorded.
  const zzper = by("public.get_accountant_for_zzper(uuid)");
  assert.equal(zzper.kind, "obsolete");
  assert.deepEqual(zzper.intent, { anon: "DENY", authenticated: "DENY", serviceRole: "DENY", public: "DENY" });
  assert.deepEqual(Object.keys(zzper.acceptedDeviations ?? {}).sort(), ["anon", "authenticated", "public", "serviceRole"]);
});

test("[PRIVILEGE-REGISTRY] the counts are pinned, so changing an UNKNOWN or a deviation is a visible act", () => {
  assert.equal(liveEntries().length, 52, "52 postgres-owned functions in public were measured: 36 SECURITY DEFINER + 16 INVOKER");
  assert.equal(liveEntries().filter((e) => e.definer).length, 36);
  // 40 → 33: the 2026-09-20 evidence pass resolved seven (answer_mollie_refund authenticated;
  // acting_for_owner anon + public; get_accountant_for_zzper all four).
  // 33 → 28: batch 2 resolved five (is_my_accountant_client public; accountant_status_door_only
  // serviceRole + public; grant_welcome_plus serviceRole + public).
  assert.equal(unknownCount(), 28);
  // 22 → 29: the same seven, recorded as deviations because production was deliberately not changed.
  // 29 → 34: the five of batch 2, for the same reason.
  assert.equal(acceptedDeviationCount(), 34);
  assert.equal(PLATFORM_CLASSES.length, 1);
  assert.equal(EXPECTED_FUNCTION_DEFAULT_ACL.length, 8, "eight function-type rows in pg_default_acl were measured");
});

// ── Gate 3: the generated artefacts are current ───────────────────────────────────────────────

test("[PRIVILEGE-REGISTRY] tests/sql/privilege-intent.sql and docs/PRIVILEGE_ORACLE.sql are generated from the registry", () => {
  const hint = "\n  regenerate with: npx tsx scripts/privilege-oracle.ts --write";
  assert.equal(readFileSync(INTENT_SQL_PATH, "utf8"), renderIntentSql(index), `${INTENT_SQL_PATH} is stale${hint}`);
  assert.equal(readFileSync(ORACLE_SQL_PATH, "utf8"), renderOracleSql(index), `${ORACLE_SQL_PATH} is stale${hint}`);
});

test("[PRIVILEGE-REGISTRY] the oracle reads privileges, never text, and writes nothing", () => {
  const sql = readFileSync(ORACLE_SQL_PATH, "utf8").replace(/--[^\n]*/g, "");
  assert.match(sql, /has_function_privilege\('anon'/);
  assert.match(sql, /aclexplode\(p\.proacl\)/, "the PUBLIC entry must be read from the ACL, not guessed from a name");
  assert.match(sql, /supabase_migrations\.schema_migrations/, "the provenance block must read production migration history");
  assert.match(sql, /pg_default_acl/, "the default-ACL shape must be asserted");
  // Read-only is asserted over the STATEMENTS: string literals (reasons, embedded regexes) may
  // mention a GRANT; the SQL outside them may not contain one.
  const statements = sql.replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(statements, /\b(grant|revoke|alter\s+default\s+privileges|alter\s+function|create\s+or\s+replace|insert\s+into|update\s+\w+\s+set|delete\s+from|drop\s+)\b/i,
    "the oracle is read-only");
  // UNKNOWN is printed with the actual value; it must not collapse into a boolean anywhere.
  assert.match(sql, /'UNKNOWN\(' \|\| anon_x::text \|\| '\)'/);
  // Each live function appears exactly once in the per-function block's VALUES.
  for (const e of liveEntries()) {
    const n = sql.split(`('${e.signature}', '${e.kind}'`).length - 1;
    assert.equal(n, 1, `${e.signature} must appear once in the intent VALUES, found ${n}`);
  }
  // The forensic column is labelled as such, and the verdict does not depend on it.
  assert.match(sql, /acl_md5 AS acl_md5_forensic_only/);
  assert.doesNotMatch(sql, /WHEN\s+[^\n]*acl_md5[^\n]*THEN\s+'DRIFT'/i);
});

test("[PRIVILEGE-REGISTRY] the seam check runs between the migrations and the test file, with the loaded list", () => {
  const sh = readFileSync("scripts/sql-seam-test.sh", "utf8").replace(/^\s*#.*$/gm, "");
  const intentAt = sh.indexOf("privilege-intent.sql");
  const checkAt = sh.indexOf("privilege-check.sql");
  const testAt = sh.indexOf('args+=(-f "$test_file")');
  assert.ok(intentAt > 0 && checkAt > intentAt && checkAt < testAt, "intent, then check, then the test file");
  assert.match(sh, /-v "loaded=\$loaded"/, "the loaded migration list must reach the check");
  const check = readFileSync("tests/sql/privilege-check.sql", "utf8").replace(/--[^\n]*/g, "");
  assert.match(check, /has_function_privilege\('anon'/);
  assert.match(check, /NO registry row/, "an unregistered function must fail the seam");
  assert.match(check, /acl_files <@ loaded/, "a partial replay is reported, not judged");
  assert.match(check, /IF intents\[i\] = 'UNKNOWN' THEN/, "UNKNOWN decides nothing");
  assert.match(check, /RAISE EXCEPTION/, "a hard mismatch must fail the run");
  const fixture = readFileSync("tests/sql/fixture.sql", "utf8").replace(/--[^\n]*/g, "");
  assert.match(fixture, /ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role/,
    "the fixture must reproduce Supabase's default grant, or the seam proves the right thing in a world where the bug cannot exist");
});

// ── Mutations: the gates must bite ─────────────────────────────────────────────────────────────

/** An EXISTING identity: live and measured, service_role only. */
const LIVE_FN: FunctionEntry = {
  signature: "public.known_fn(uuid, integer)", kind: "server_rpc", managedBy: "boekbrug", owner: "postgres", definer: true,
  status: "live", intent: { anon: "DENY", authenticated: "DENY", serviceRole: "ALLOW", public: "DENY" },
  current: { anon: false, authenticated: false, serviceRole: true, publicEntry: false, aclMd5: "0".repeat(32) },
  evidence: ["synthetic"], callers: ["synthetic"], provenance: { inRepo: true, productionVersions: [] }, verified: { at: "2026-01-01", source: "synthetic" },
};
/** A NEW identity: declared, not yet applied or measured. */
const PLANNED_FN: FunctionEntry = {
  ...LIVE_FN, signature: "public.new_fn(uuid)", status: "planned", current: null, verified: null,
};
/** An existing identity a session may call, with one UNKNOWN. */
const LIVE_CLIENT_FN: FunctionEntry = {
  ...LIVE_FN, signature: "public.client_fn(uuid)", kind: "client_rpc",
  intent: { anon: "DENY", authenticated: "ALLOW", serviceRole: "ALLOW", public: "UNKNOWN" },
  current: { anon: false, authenticated: true, serviceRole: true, publicEntry: false, aclMd5: "0".repeat(32) },
};
const FAKES = [LIVE_FN, PLANNED_FN, LIVE_CLIENT_FN];
const problems = (f: MigrationFinding[]) => f.map((x) => x.problem).sort();
const NEW = { grandfathered: false } as const;

test("[PRIVILEGE-REGISTRY][MUTATION] identity is decided by registry status, not by the words OR REPLACE", () => {
  assert.equal(isExistingIdentity(LIVE_FN), true);
  assert.equal(isExistingIdentity(PLANNED_FN), false);
  assert.equal(isExistingIdentity({ ...LIVE_FN, status: "not_in_production", current: null, verified: null }), false);
  assert.equal(isExistingIdentity(undefined), false);
});

test("[PRIVILEGE-REGISTRY][MUTATION] a migration creating an unregistered function is caught", () => {
  const sql = `CREATE OR REPLACE FUNCTION public.brand_new(p_user_id uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
    REVOKE ALL ON FUNCTION public.brand_new(uuid) FROM PUBLIC, anon, authenticated, service_role;`;
  const f = checkMigration("x.sql", sql, FAKES, NEW);
  assert.deepEqual(problems(f), ["no_registry_entry"]);
  assert.equal(f[0].signature, "public.brand_new(uuid)");
});

test("[PRIVILEGE-REGISTRY][MUTATION] NEW identity + missing four-path decision → fail (the refund-writer shape)", () => {
  // CREATE OR REPLACE is how new functions are usually introduced, so the words prove nothing:
  // new_fn is new because its registry row is `planned`.
  const sql = `CREATE OR REPLACE FUNCTION public.new_fn(p_user_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
    REVOKE ALL ON FUNCTION public.new_fn(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.new_fn(uuid) TO service_role;`;
  const f = checkMigration("x.sql", sql, FAKES, NEW);
  assert.deepEqual(problems(f), ["default_paths_not_handled"]);
  assert.deepEqual(f[0].missing, ["anon", "authenticated"], "PUBLIC and service_role were decided; anon and authenticated were not");
  // …accepted once the two are decided in the registry's direction…
  const fixed = sql + "\n    REVOKE ALL ON FUNCTION public.new_fn(uuid) FROM anon, authenticated;";
  assert.deepEqual(checkMigration("x.sql", fixed, FAKES, NEW), []);
  // …and a plain CREATE with no privilege SQL at all is the worst case: all four undecided.
  const bare = `CREATE FUNCTION public.new_fn(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;`;
  assert.deepEqual(checkMigration("x.sql", bare, FAKES, NEW)[0]?.missing, ["anon", "authenticated", "serviceRole", "public"]);
  // The rule is suspended, but registration is not, for a grandfathered file.
  assert.deepEqual(checkMigration("x.sql", sql, FAKES, { grandfathered: true }), []);
  assert.deepEqual(problems(checkMigration("x.sql", sql, [], { grandfathered: true })), ["no_registry_entry"]);
});

test("[PRIVILEGE-REGISTRY][MUTATION] EXISTING identity + body-only CREATE OR REPLACE → pass without any privilege SQL", () => {
  // 1. live + body-only CREATE OR REPLACE → PASS: the ACL survives the replacement.
  const replace = `CREATE OR REPLACE FUNCTION public.known_fn(p_user_id uuid, p_n integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN PERFORM 2; END $$;`;
  assert.deepEqual(checkMigration("x.sql", replace, FAKES, NEW), [],
    "the ACL survives a CREATE OR REPLACE; forcing a body-only migration to rewrite privileges is the wrong invariant");
  // 2. live + plain CREATE without a four-path decision → FAIL. A plain CREATE is fresh object
  //    creation to PostgreSQL: it fails if the function exists, and if it succeeds the object was
  //    absent (dropped by some earlier migration) and received creation-time defaults.
  const plain = `CREATE FUNCTION public.known_fn(p uuid, n integer) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;`;
  const f = checkMigration("x.sql", plain, FAKES, NEW);
  assert.deepEqual(problems(f), ["default_paths_not_handled"]);
  assert.deepEqual(f[0].missing, ["anon", "authenticated", "serviceRole", "public"]);
  const plainProcedure = `CREATE PROCEDURE public.known_fn(p uuid, n integer) LANGUAGE sql AS $$ SELECT 1 $$;`;
  assert.deepEqual(problems(checkMigration("x.sql", plainProcedure, FAKES, NEW)), ["default_paths_not_handled"]);
  // 3. live + plain CREATE with the four paths decided in the registry's direction → PASS.
  const decided = plain + `\n REVOKE ALL ON FUNCTION public.known_fn(uuid, integer) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO service_role;`;
  assert.deepEqual(checkMigration("x.sql", decided, FAKES, NEW), []);
  // 4. live + DROP then CREATE OR REPLACE → FAIL unless the four paths are decided.
  const dropReplace = `DROP FUNCTION IF EXISTS public.known_fn(uuid, integer);\n` + replace;
  assert.deepEqual(problems(checkMigration("x.sql", dropReplace, FAKES, NEW)), ["default_paths_not_handled"]);
  assert.deepEqual(checkMigration("x.sql", dropReplace + `\n REVOKE ALL ON FUNCTION public.known_fn(uuid, integer) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO service_role;`, FAKES, NEW), []);
  // 5. planned/new + CREATE OR REPLACE → still requires the four paths.
  const newReplace = `CREATE OR REPLACE FUNCTION public.new_fn(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;`;
  assert.deepEqual(problems(checkMigration("x.sql", newReplace, FAKES, NEW)), ["default_paths_not_handled"]);
  // Grandfathered history is exempt from the rule, not from registration.
  assert.deepEqual(checkMigration("x.sql", plain, FAKES, { grandfathered: true }), []);
});

test("[PRIVILEGE-REGISTRY][MUTATION] EXISTING identity + explicit privilege change → validated against intent", () => {
  const body = `CREATE OR REPLACE FUNCTION public.known_fn(p uuid, n integer) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;`;
  // registry DENY + final explicit GRANT → fail
  const wrongGrant = checkMigration("x.sql", body + `\n GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO anon;`, FAKES, NEW);
  assert.deepEqual(problems(wrongGrant), ["contradicts_intent"]);
  assert.equal(wrongGrant[0].role, "anon");
  assert.match(wrongGrant[0].detail!, /final explicit GRANT but registry intent is DENY/);
  // registry ALLOW + final explicit REVOKE without a later GRANT → fail
  const wrongRevoke = checkMigration("x.sql", body + `\n REVOKE ALL ON FUNCTION public.known_fn(uuid, integer) FROM service_role;`, FAKES, NEW);
  assert.deepEqual(problems(wrongRevoke), ["contradicts_intent"]);
  assert.equal(wrongRevoke[0].role, "serviceRole");
  // a consistent explicit change passes
  const fine = body + `\n REVOKE ALL ON FUNCTION public.known_fn(uuid, integer) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO service_role;`;
  assert.deepEqual(checkMigration("x.sql", fine, FAKES, NEW), []);
  // the same wrong decision without any CREATE in the file (a privilege-only migration) is caught too
  assert.deepEqual(problems(checkMigration("x.sql", `GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO authenticated;`, FAKES, NEW)),
    ["contradicts_intent"]);
});

test("[PRIVILEGE-REGISTRY][MUTATION] the FINAL statement decides: order matters both ways", () => {
  const grantThenRevoke = `GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO anon;
    REVOKE ALL ON FUNCTION public.known_fn(uuid, integer) FROM anon;`;
  assert.deepEqual(checkMigration("x.sql", grantThenRevoke, FAKES, NEW), [], "a GRANT that is revoked again in the same file ends as DENY");
  const revokeThenGrant = `REVOKE ALL ON FUNCTION public.known_fn(uuid, integer) FROM anon;
    GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO anon;`;
  assert.deepEqual(problems(checkMigration("x.sql", revokeThenGrant, FAKES, NEW)), ["contradicts_intent"]);
  // "registry ALLOW + REVOKE" is fine when a later GRANT restores it
  const revokeThenRegrant = `REVOKE ALL ON FUNCTION public.client_fn(uuid) FROM PUBLIC, authenticated;
    GRANT EXECUTE ON FUNCTION public.client_fn(uuid) TO authenticated;`;
  assert.deepEqual(problems(checkMigration("x.sql", revokeThenRegrant, FAKES, NEW)), ["unknown_intent_touched"], "PUBLIC is UNKNOWN on client_fn: reported, not failed");
});

test("[PRIVILEGE-REGISTRY][MUTATION] UNKNOWN is reported, never decided", () => {
  const sql = `GRANT EXECUTE ON FUNCTION public.client_fn(uuid) TO PUBLIC;`;
  const f = checkMigration("x.sql", sql, FAKES, NEW);
  assert.deepEqual(problems(f), ["unknown_intent_touched"]);
  assert.equal(f[0].role, "public");
  // …and the opposite direction on the same UNKNOWN is equally only a report.
  assert.deepEqual(problems(checkMigration("x.sql", `REVOKE ALL ON FUNCTION public.client_fn(uuid) FROM PUBLIC;`, FAKES, NEW)), ["unknown_intent_touched"]);
});

test("[PRIVILEGE-REGISTRY][MUTATION] privilege SQL the reader cannot prove is surfaced as unproven, not blessed", () => {
  const dynamicRole = `DO $$ DECLARE r text := 'anon'; BEGIN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO %I', r);
    END $$;`;
  assert.deepEqual(problems(checkMigration("x.sql", dynamicRole, FAKES, NEW)), ["unproven_privilege_sql"]);
  const dynamicFunction = `DO $$ DECLARE sig text; BEGIN
      FOR sig IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', sig);
      END LOOP; END $$;`;
  assert.deepEqual(problems(checkMigration("x.sql", dynamicFunction, FAKES, NEW)), ["unproven_privilege_sql"],
    "no name literal identifies the target; the loop could be revoking anon from is_my_accountant_client");
  const wildcard = `REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;`;
  assert.deepEqual(problems(checkMigration("x.sql", wildcard, FAKES, NEW)), ["unproven_privilege_sql"]);
  // A new identity cannot satisfy the four paths through unproven SQL either.
  const newViaDynamic = `CREATE FUNCTION public.new_fn(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
    DO $$ DECLARE sig text; BEGIN FOR sig IN SELECT 'x' LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', sig); END LOOP; END $$;`;
  assert.deepEqual(problems(checkMigration("x.sql", newViaDynamic, FAKES, NEW)), ["default_paths_not_handled", "unproven_privilege_sql"]);
});

test("[PRIVILEGE-REGISTRY][MUTATION] a GRANT/REVOKE on a function the registry does not know is caught", () => {
  assert.deepEqual(problems(checkMigration("x.sql", `GRANT EXECUTE ON FUNCTION public.stranger(uuid) TO anon;`, FAKES, NEW)),
    ["privilege_on_unregistered_function"]);
  // A name some OTHER migration once dropped is not a waiver: the first version exempted every such
  // name from registration, the four paths and direction, in every file.
  const real = REGISTRY;
  const revived = `CREATE FUNCTION public.generate_invoice_number(p uuid) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'x' $$;
    GRANT EXECUTE ON FUNCTION public.generate_invoice_number(uuid) TO anon;`;
  assert.deepEqual(problems(checkMigration("x.sql", revived, real, NEW)), ["no_registry_entry"]);
  // The only exemption: a helper created and dropped again in the SAME file, after its use.
  const transient = `CREATE FUNCTION public.helper_once(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
    REVOKE ALL ON FUNCTION public.helper_once(uuid) FROM PUBLIC, anon, authenticated, service_role;
    SELECT public.helper_once('00000000-0000-0000-0000-000000000000');
    DROP FUNCTION public.helper_once(uuid);`;
  assert.deepEqual(checkMigration("x.sql", transient, FAKES, NEW), []);
  // …and a GRANT on an overload the registry does not know is caught one level down.
  const overload = `GRANT EXECUTE ON FUNCTION public.known_fn(uuid, numeric(12,2), text[]) TO service_role;`;
  const f = checkMigration("x.sql", overload, FAKES, NEW);
  assert.deepEqual(problems(f), ["privilege_on_unregistered_function"]);
  assert.equal(f[0].signature, "public.known_fn(uuid, numeric, text[])");
});

test("[PRIVILEGE-REGISTRY][MUTATION] a REVOKE written in a comment counts for nothing", () => {
  const sql = `CREATE FUNCTION public.new_fn(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
    -- REVOKE ALL ON FUNCTION public.new_fn(uuid) FROM PUBLIC, anon, authenticated, service_role;
    /* GRANT EXECUTE ON FUNCTION public.new_fn(uuid) TO anon; */`;
  const f = checkMigration("x.sql", sql, FAKES, NEW);
  assert.deepEqual(problems(f), ["default_paths_not_handled"]);
  assert.deepEqual(f[0].missing, ["anon", "authenticated", "serviceRole", "public"]);
});

test("[PRIVILEGE-REGISTRY][MUTATION] the DO-loop shape (rpc_anon_revoke.sql) is read with direction and per block", () => {
  const loop = `DO $$ DECLARE fn text; sig text; BEGIN
      FOREACH fn IN ARRAY ARRAY['known_fn'] LOOP
        FOR sig IN SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) FROM pg_proc p WHERE p.proname = fn LOOP
          EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', sig);
          EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', sig);
          EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
        END LOOP; END LOOP; END $$;`;
  assert.deepEqual([...grantPathsHandled(loop, "known_fn")].sort(), ["anon", "authenticated", "public", "serviceRole"]);
  assert.deepEqual(checkMigration("x.sql", loop, FAKES, NEW), [], "consistent with known_fn's intent");
  // The same block granting anon is a contradiction, found through the block's name literal.
  const wrong = loop.replace("REVOKE ALL ON FUNCTION %s FROM anon, authenticated", "GRANT EXECUTE ON FUNCTION %s TO anon");
  assert.deepEqual(problems(checkMigration("x.sql", wrong, FAKES, NEW)), ["contradicts_intent"]);
  // A second block with its own array does not leak its effects into the first block's functions.
  const two = loop + `\nDO $$ DECLARE fn text; sig text; BEGIN FOREACH fn IN ARRAY ARRAY['client_fn'] LOOP
      FOR sig IN SELECT 'public.client_fn(uuid)' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', sig); END LOOP; END LOOP; END $$;`;
  const f = checkMigration("x.sql", two, FAKES, NEW);
  assert.deepEqual(f.map((x) => `${x.problem}:${x.fn}:${x.role}`), ["contradicts_intent:client_fn:authenticated"], "known_fn keeps its own block's decisions");
  // The name in a string literal without any format('REVOKE …') is just a string.
  assert.equal(grantPathsHandled(`SELECT 'known_fn'; REVOKE ALL ON FUNCTION public.other(uuid) FROM anon;`, "known_fn").size, 0);
  // A REVOKE on ANOTHER function does not count for this one.
  assert.equal(grantPathsHandled(`REVOKE ALL ON FUNCTION public.other_fn(uuid) FROM PUBLIC, anon, authenticated, service_role;`, "known_fn").size, 0);
});

test("[PRIVILEGE-REGISTRY][MUTATION] the statement splitter follows PostgreSQL: dollar bodies, strings, E-strings, nested comments", () => {
  const sql = `CREATE FUNCTION public.a() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1; PERFORM 2; END $$;
    SELECT 'a;b', E'\\'', $$ -- not a comment; $$, x$a$y;
    /* a /* nested */ comment; */
    GRANT EXECUTE ON FUNCTION public.a() TO service_role`;
  const parts = splitStatements(stripSql(sql));
  assert.equal(parts.length, 3, parts.map((p) => p.sql.slice(0, 30)).join(" | "));
  assert.match(parts[0].sql, /^CREATE FUNCTION/);
  assert.match(parts[1].sql, /^SELECT 'a;b'/);
  assert.match(parts[2].sql, /^GRANT/);
  const reading = readPrivilegeStatements(sql, new Set(["a"]));
  assert.deepEqual(reading.effects.map((e) => `${e.fn}:${e.role}:${e.action}:${e.via}`), ["a:serviceRole:GRANT:direct"]);
  assert.deepEqual(reading.unproven, []);
  assert.deepEqual([...finalDecisions(reading).get("a")!], [["serviceRole", "GRANT"]]);
  // A string inside a DO body is what EXECUTE runs: it is never ignored, and never blessed either.
  const inBody = `DO $body$ BEGIN EXECUTE 'GRANT EXECUTE ON FUNCTION public.a() TO anon'; END $body$;`;
  const r2 = readPrivilegeStatements(inBody, new Set(["a"]));
  assert.deepEqual(r2.effects, []);
  assert.equal(r2.unproven.length, 1);
  assert.match(r2.unproven[0], /could not account for/);
});

test("[PRIVILEGE-REGISTRY][MUTATION] signature parsing meets PostgreSQL's identity form", () => {
  assert.equal(normaliseType("int"), "integer");
  assert.equal(normaliseType("INT4"), "integer");
  assert.equal(normaliseType("numeric(12,2)"), "numeric");
  assert.equal(normaliseType("text[]"), "text[]");
  assert.equal(normaliseType("text []"), "text[]");
  assert.equal(normaliseType("timestamptz"), "timestamp with time zone");
  assert.equal(normaliseType("varchar(40)"), "character varying");
  assert.equal(normaliseType("bool"), "boolean");
  assert.equal(identityTypeOfArgument("p_user_id uuid DEFAULT NULL"), "uuid");
  assert.equal(identityTypeOfArgument("p_statuses text[] DEFAULT ARRAY['a','b']::text[]"), "text[]");
  assert.equal(identityTypeOfArgument("OUT total numeric"), null, "OUT parameters are not part of the identity");
  assert.equal(identityTypeOfArgument("INOUT p numeric"), "numeric");
  assert.equal(identityTypeOfArgument("p_at timestamp with time zone"), "timestamp with time zone");
  assert.equal(identityTypeOfArgument("uuid"), "uuid", "an unnamed parameter");
  const created = functionsCreatedBy(`
    create or replace function apply_manual_payment(
      p_user_id uuid, p_invoice_id uuid, p_amount numeric(12,2), p_pay_date date, p_method text,
      p_payable_statuses text[] DEFAULT ARRAY['sent','overdue']::text[], p_client_key uuid DEFAULT NULL)
    RETURNS TABLE (ok boolean, reason text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ BEGIN END $$;
    CREATE FUNCTION auth.not_ours() RETURNS void LANGUAGE sql AS 'select 1';
    CREATE FUNCTION public.invoker_one() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;`);
  assert.deepEqual(created.map((c) => [c.signature, c.replace, c.definer]), [
    ["public.apply_manual_payment(uuid, uuid, numeric, date, text, text[], uuid)", true, true],
    ["public.invoker_one()", false, false],
  ]);
  assert.deepEqual(functionsDroppedBy("DROP FUNCTION IF EXISTS public.generate_invoice_number(uuid); drop function other.x();"), ["generate_invoice_number"]);
});

test("[PRIVILEGE-REGISTRY][MUTATION] SECURITY DEFINER is read from THIS function's header, not from the next one's", () => {
  const two = functionsCreatedBy(`
    CREATE FUNCTION public.a() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
    CREATE FUNCTION public.b() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;`);
  assert.deepEqual(two.map((c) => c.definer), [false, true]);
});

test("[PRIVILEGE-REGISTRY][MUTATION] the intent SQL carries UNKNOWN as a value, never as false", () => {
  const sql = renderIntentSql(index);
  assert.match(sql, /'UNKNOWN'/);
  assert.match(sql, /CHECK \(i_anon IN \('ALLOW','DENY','UNKNOWN'\)\)/);
  // Every registry function is present, and a function is present once.
  for (const e of REGISTRY) assert.equal(sql.split(`('${e.signature}',`).length - 1, 1, e.signature);
  // The ACL-shaping files are real files: a made-up name would make every comparison PARTIAL forever.
  for (const m of sql.matchAll(/ARRAY\[([^\]]+)\]::text\[\]/g)) {
    for (const f of m[1].split(",")) assert.ok(files.includes(f.trim().replace(/^'|'$/g, "")), `${f} is named as an ACL-shaping migration but does not exist`);
  }
});

test("[PRIVILEGE-REGISTRY][MUTATION] an entry whose repo provenance is wrong is caught either way", () => {
  // Says "in repo" for a function no file creates…
  const ghost: FunctionEntry = { ...LIVE_FN, signature: "public.nobody_creates_me()" };
  assert.equal((index.createdIn.get(nameOf(ghost.signature)) ?? []).length, 0);
  // …and says "not in repo" for one a file does create.
  const real = REGISTRY.find((e) => e.signature === "public.allocate_bank_payment(uuid, uuid, uuid, numeric, date)")!;
  assert.ok((index.createdIn.get(nameOf(real.signature)) ?? []).length > 0);
  assert.equal(real.provenance.inRepo, true);
});

test("[PRIVILEGE-REGISTRY][MUTATION] a platform function is a class, not an unknown BoekBrug RPC", () => {
  const sql = renderOracleSql(index);
  assert.match(sql, /\('supabase_admin', 'pg_trgm'\)/, "the pg_trgm class must be declared");
  assert.match(sql, /'UNEXPECTED_PLATFORM_FUNCTION'/);
  assert.match(sql, /'PLATFORM_FUNCTION_IS_DEFINER'/);
  // The UNREGISTERED finding is scoped to postgres-owned functions; a pg_trgm function must not land there.
  assert.match(sql, /WHERE l\.owner = 'postgres' AND r\.sig IS NULL/);
  assert.ok(!REGISTRY.some((e) => /gtrgm|similarity|show_trgm/.test(e.signature)), "extension functions do not get registry rows");
});

test("[PRIVILEGE-REGISTRY][MUTATION] the provenance block classifies by name and by acknowledged function set", () => {
  const sql = renderOracleSql(index, ["only_this_file.sql"]);
  assert.match(sql, /repo\(name\) AS \(VALUES\n  \('only_this_file'\)/, "the repo file list is embedded from disk at generation time");
  assert.match(sql, /'ACKNOWLEDGED_BUT_DIFFERENT'/, "an acknowledgement whose function set no longer matches production is its own verdict");
  assert.match(sql, /ELSE 'DRIFT' END AS provenance/);
  for (const a of ACKNOWLEDGED_PRODUCTION_MIGRATIONS) assert.ok(sql.includes(`('${a.version}', '${a.name}'`), `${a.name} must be embedded`);
});

// ── Mutations from the adversarial review: every hole it found, closed and pinned ─────────────

test("[PRIVILEGE-REGISTRY][MUTATION] a GRANT after BEGIN or IF … THEN inside a DO block is read, with direction", () => {
  const begin = `DO $$ BEGIN GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO anon; END $$;`;
  assert.deepEqual(problems(checkMigration("x.sql", begin, FAKES, NEW)), ["contradicts_intent"]);
  const guarded = `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO anon; END IF; END $$;`;
  assert.deepEqual(problems(checkMigration("x.sql", guarded, FAKES, NEW)), ["contradicts_intent"]);
  // …and the consistent version passes.
  const fine = guarded.replace("TO anon", "TO service_role").replace("GRANT EXECUTE", "GRANT EXECUTE");
  assert.deepEqual(checkMigration("x.sql", fine, FAKES, NEW), []);
});

test("[PRIVILEGE-REGISTRY][MUTATION] privilege SQL hidden in a string the reader does not read is unproven, never silent", () => {
  const shapes = [
    `DO $$ BEGIN EXECUTE 'GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO anon'; END $$;`,
    `DO $$ DECLARE r text := 'anon'; BEGIN EXECUTE 'GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO ' || r; END $$;`,
    `DO $$ BEGIN EXECUTE format($f$GRANT EXECUTE ON FUNCTION %s TO anon$f$, 'public.known_fn(uuid, integer)'); END $$;`,
    `DO $$ DECLARE t text := 'GRANT EXECUTE ON FUNCTION %s TO anon'; BEGIN EXECUTE format(t, 'public.known_fn(uuid, integer)'); END $$;`,
    `DO $$ BEGIN EXECUTE format('%s EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO anon', 'GRANT'); END $$;`,
    `CREATE OR REPLACE FUNCTION public.known_fn(p uuid, n integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
       BEGIN GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO anon; END $$;`,
    `CREATE OR REPLACE FUNCTION public.known_fn(p uuid, n integer) RETURNS void LANGUAGE plpgsql AS 'BEGIN EXECUTE ''GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO anon''; END';`,
  ];
  for (const sql of shapes) {
    const f = checkMigration("x.sql", sql, FAKES, NEW);
    assert.deepEqual(problems(f), ["unproven_privilege_sql"], sql.slice(0, 80));
  }
  // A single-quoted DO body is read like a dollar-quoted one.
  const doString = `DO 'BEGIN GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO anon; END';`;
  assert.deepEqual(problems(checkMigration("x.sql", doString, FAKES, NEW)), ["contradicts_intent"]);
  // A string at the top level that is not a body is text: COMMENT ON may say GRANT all it likes.
  const comment = `COMMENT ON FUNCTION public.known_fn(uuid, integer) IS 'GRANT is deliberately absent here';`;
  assert.deepEqual(checkMigration("x.sql", comment, FAKES, NEW), []);
});

test("[PRIVILEGE-REGISTRY][MUTATION] the lexer cannot be desynchronised from PostgreSQL to hide a GRANT", () => {
  const wrong = `GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO anon;`;
  const disguises = [
    `SELECT $$ -- $$;\n${wrong}`,
    `CREATE OR REPLACE FUNCTION public.known_fn(p uuid, n integer) RETURNS void LANGUAGE sql AS $$ SELECT 1 -- done $$;\n${wrong}`,
    `SELECT E'\\'';\n${wrong}`,
    `SELECT 1 AS x$a$y;\n${wrong}`,
  ];
  for (const sql of disguises) {
    assert.deepEqual(problems(checkMigration("x.sql", sql, FAKES, NEW)), ["contradicts_intent"], sql.slice(0, 60));
  }
  // …and the reverse: decisions inside a nested block comment, or after a swallowed line, did not run.
  const nested = `CREATE FUNCTION public.new_fn(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
    /* /* */ REVOKE ALL ON FUNCTION public.new_fn(uuid) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.new_fn(uuid) TO service_role; */`;
  assert.deepEqual(checkMigration("x.sql", nested, FAKES, NEW)[0]?.missing, ["anon", "authenticated", "serviceRole", "public"]);
  const apostrophe = `CREATE FUNCTION public.new_fn(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT $n$it's$n$ $$;
    SELECT 1 --; REVOKE ALL ON FUNCTION public.new_fn(uuid) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.new_fn(uuid) TO service_role;
    ;`;
  assert.deepEqual(checkMigration("x.sql", apostrophe, FAKES, NEW)[0]?.missing, ["anon", "authenticated", "serviceRole", "public"]);
});

test("[PRIVILEGE-REGISTRY][MUTATION] DROP then CREATE of a live function is a new identity: the ACL was reset", () => {
  const sql = `DROP FUNCTION public.known_fn(uuid, integer);
    CREATE FUNCTION public.known_fn(p uuid, n integer) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;`;
  const f = checkMigration("x.sql", sql, FAKES, NEW);
  assert.deepEqual(problems(f), ["default_paths_not_handled"]);
  assert.deepEqual(f[0].missing, ["anon", "authenticated", "serviceRole", "public"]);
  const withIfExists = sql.replace("DROP FUNCTION", "DROP FUNCTION IF EXISTS").replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");
  assert.deepEqual(problems(checkMigration("x.sql", withIfExists, FAKES, NEW)), ["default_paths_not_handled"]);
  // Decided again after the re-creation, it passes.
  const decided = sql + `\n REVOKE ALL ON FUNCTION public.known_fn(uuid, integer) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO service_role;`;
  assert.deepEqual(checkMigration("x.sql", decided, FAKES, NEW), []);
  assert.deepEqual(functionsDroppedBy("DROP FUNCTION public.a(uuid), public.b(uuid); DROP ROUTINE IF EXISTS public.c(); drop procedure other.d();"), ["a", "b", "c"]);
});

test("[PRIVILEGE-REGISTRY][MUTATION] a DO loop's target must be a literal name list the loop provably uses", () => {
  const negated = `DO $$ DECLARE sig text; BEGIN FOR sig IN SELECT oid::regprocedure::text FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace AND proname <> 'known_fn' LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig); END LOOP; END $$;`;
  const decoy = `DO $$ DECLARE sig text; BEGIN RAISE NOTICE 'client_fn';
      FOR sig IN SELECT oid::regprocedure::text FROM pg_proc p WHERE p.proname = 'known' || '_fn' LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', sig); END LOOP; END $$;`;
  const regclass = `DO $$ DECLARE sig text; BEGIN IF to_regclass('known_fn') IS NULL THEN
      FOR sig IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig); END LOOP; END IF; END $$;`;
  for (const sql of [negated, decoy, regclass]) {
    const f = checkMigration("x.sql", sql, FAKES, NEW);
    assert.ok(f.length > 0 && f.every((x) => x.problem === "unproven_privilege_sql"), sql.slice(0, 60));
    assert.ok(readPrivilegeStatements(sql, new Set(["known_fn", "client_fn"])).effects.length === 0, "no effect may be invented from a stray literal");
  }
  // The two documented shapes are still read.
  const byLiteral = `DO $$ DECLARE sig text; BEGIN FOR sig IN SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'known_fn' LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', sig); END LOOP; END $$;`;
  assert.deepEqual(checkMigration("x.sql", byLiteral, FAKES, NEW), []);
  assert.deepEqual(readPrivilegeStatements(byLiteral, new Set(["known_fn"])).effects.map((e) => `${e.fn}:${e.role}:${e.action}`), ["known_fn:anon:REVOKE"]);
});

test("[PRIVILEGE-REGISTRY][MUTATION] grantee spellings and trailing clauses cannot make a role disappear", () => {
  assert.deepEqual(problems(checkMigration("x.sql", `GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO GROUP anon;`, FAKES, NEW)), ["contradicts_intent"]);
  assert.deepEqual(problems(checkMigration("x.sql", `GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO anon WITH GRANT OPTION GRANTED BY postgres;`, FAKES, NEW)), ["contradicts_intent"]);
  assert.deepEqual(problems(checkMigration("x.sql", `GRANT ALL PRIVILEGES ON FUNCTION "public"."known_fn"(uuid, integer) TO "anon", dashboard_user CASCADE;`, FAKES, NEW)), ["contradicts_intent"]);
  // A grantee list with no recognised role is unproven, not a pass.
  assert.deepEqual(problems(checkMigration("x.sql", `GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO some_new_role;`, FAKES, NEW)), ["unproven_privilege_sql"]);
  // Wildcards over routines and procedures are as unproven as over functions.
  for (const w of ["FUNCTIONS", "ROUTINES", "PROCEDURES"]) {
    assert.deepEqual(problems(checkMigration("x.sql", `GRANT EXECUTE ON ALL ${w} IN SCHEMA public TO anon;`, FAKES, NEW)), ["unproven_privilege_sql"], w);
  }
});

test("[PRIVILEGE-REGISTRY][MUTATION] privilege-shaping DDL the gate does not model is unproven, never silent", () => {
  const shapes = [
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon;`,
    `ALTER FUNCTION public.known_fn(uuid, integer) OWNER TO anon;`,
    `ALTER FUNCTION public.known_fn(uuid, integer) SECURITY DEFINER;`,
    `GRANT service_role TO authenticated;`,
    `CREATE FUNCTION public.new_fn(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$; SAVEPOINT s;
     REVOKE ALL ON FUNCTION public.new_fn(uuid) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.new_fn(uuid) TO service_role;
     ROLLBACK TO SAVEPOINT s;`,
  ];
  for (const sql of shapes) {
    const f = checkMigration("x.sql", sql, FAKES, NEW);
    assert.ok(f.some((x) => x.problem === "unproven_privilege_sql"), sql.slice(0, 60));
    assert.ok(!f.some((x) => x.problem === "contradicts_intent" && sql.startsWith("ALTER")), "an ALTER is reported as unmodelled, not misread as a grant");
  }
  // ALTER FUNCTION … SET search_path (function_search_path.sql) changes no privilege and stays silent.
  assert.deepEqual(checkMigration("x.sql", `ALTER FUNCTION public.known_fn(uuid, integer) SET search_path = public;`, FAKES, NEW), []);
});

test("[PRIVILEGE-REGISTRY][MUTATION] a CREATE the reader cannot fully read is a finding, and a dynamic CREATE is unproven", () => {
  assert.deepEqual(problems(checkMigration("x.sql", `CREATE FUNCTION public . new_fn(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;`, FAKES, NEW)), ["default_paths_not_handled"]);
  assert.deepEqual(problems(checkMigration("x.sql", `CREATE FUNCTION public.\nnew_fn(p uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;`, FAKES, NEW)), ["default_paths_not_handled"]);
  assert.deepEqual(problems(checkMigration("x.sql", `DO $$ BEGIN EXECUTE format('CREATE FUNCTION public.%I(p uuid) RETURNS void LANGUAGE sql AS $b$ SELECT 1 $b$', 'brand_new'); END $$;`, FAKES, NEW)),
    ["unproven_privilege_sql"]);
  // A quoted mixed-case name is a different function from its lower-case twin.
  assert.deepEqual(functionsCreatedBy(`CREATE FUNCTION public."Known_Fn"(p uuid, n integer) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;`).map((c) => c.signature),
    ['public."Known_Fn"(uuid, integer)']);
  assert.deepEqual(problems(checkMigration("x.sql", `CREATE FUNCTION public."Known_Fn"(p uuid, n integer) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;`, FAKES, NEW)), ["no_registry_entry"]);
  // Procedures are functions to the catalog and to this gate.
  assert.deepEqual(problems(checkMigration("x.sql", `CREATE PROCEDURE public.do_money(p uuid) LANGUAGE sql AS $$ SELECT 1 $$;`, FAKES, NEW)), ["no_registry_entry"]);
  // A CREATE inside a string literal is text, not a creation.
  assert.deepEqual(checkMigration("x.sql", `SELECT 'create function public.phantom(p uuid)';`, FAKES, NEW), []);
  // SECURITY DEFINER is read from the right header even when a body is single-quoted.
  assert.deepEqual(functionsCreatedBy(`CREATE FUNCTION public.a() RETURNS void LANGUAGE sql AS 'select 1'; CREATE FUNCTION public.b() RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;`).map((c) => c.definer), [false, true]);
});

test("[PRIVILEGE-REGISTRY][MUTATION] overloads are decided per signature, not per name", () => {
  const over1: FunctionEntry = { ...LIVE_FN, signature: "public.over(uuid)" };
  const over2: FunctionEntry = { ...PLANNED_FN, signature: "public.over(uuid, text, integer)" };
  const registry = [over1, over2];
  // Deciding the OLD overload does not decide the NEW one.
  const sql = `CREATE FUNCTION public.over(p uuid, q text, r integer) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
    REVOKE ALL ON FUNCTION public.over(uuid) FROM PUBLIC, anon, authenticated; GRANT EXECUTE ON FUNCTION public.over(uuid) TO service_role;`;
  const f = checkMigration("x.sql", sql, registry, NEW);
  assert.deepEqual(problems(f), ["default_paths_not_handled"]);
  assert.equal(f[0].signature, "public.over(uuid, text, integer)");
  // A wrong GRANT on one overload is judged against THAT overload only.
  const wrongOnNew = sql + `\n REVOKE ALL ON FUNCTION public.over(uuid, text, integer) FROM PUBLIC, authenticated; GRANT EXECUTE ON FUNCTION public.over(uuid, text, integer) TO service_role, anon;`;
  const g = checkMigration("x.sql", wrongOnNew, registry, NEW);
  assert.deepEqual(g.map((x) => `${x.problem}:${x.signature}:${x.role ?? ""}`), ["contradicts_intent:public.over(uuid, text, integer):anon"]);
  // A %s placeholder resolved by NAME hits every overload, as the DO loop does in PostgreSQL.
  const byName = `DO $$ DECLARE sig text; BEGIN FOR sig IN SELECT oid::regprocedure::text FROM pg_proc WHERE proname = 'over' LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', sig); END LOOP; END $$;`;
  assert.deepEqual(checkMigration("x.sql", byName, registry, NEW).map((x) => `${x.problem}:${x.signature}`),
    ["contradicts_intent:public.over(uuid)", "contradicts_intent:public.over(uuid, text, integer)"]);
});
