// src/lib/privilege-gates.test.ts
// [PRIVILEGE-REGISTRY] The repo-level gates around scripts/privilege-registry.ts, and the mutation
// tests that prove they bite.
//
// What this file can and cannot promise, stated once so nobody reads it as more than it is:
//
//   · It reads migration TEXT and the registry. It can require that every function a migration
//     creates has a registry row, that a NEW migration names all four default grant paths, that
//     the registry is internally consistent, and that the two generated artefacts are current.
//   · It cannot see the database. CREATE OR REPLACE keeps an old ACL, a migration applied through
//     the MCP path has no file here, and a REVOKE inside a DO block is a string until it runs.
//     That is what tests/sql/privilege-check.sql (real PostgreSQL) and docs/PRIVILEGE_ORACLE.sql
//     (production catalog) are for. This file is the early warning, not the oracle.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  ACKNOWLEDGED_PRODUCTION_MIGRATIONS, EXPECTED_FUNCTION_DEFAULT_ACL, GRANTEES, PLATFORM_CLASSES, REGISTRY,
  acceptedDeviationCount, liveEntries, nameOf, unknownCount, type FunctionEntry,
} from "../../scripts/privilege-registry";
import {
  INTENT_SQL_PATH, MIGRATIONS_DIR, ORACLE_SQL_PATH,
  checkMigration, functionsCreatedBy, functionsDroppedBy, grantPathsHandled, identityTypeOfArgument, indexMigrations,
  migrationFiles, normaliseType, renderIntentSql, renderOracleSql,
} from "../../scripts/privilege-oracle";

const index = indexMigrations();
const files = migrationFiles();
const read = (f: string) => readFileSync(`${MIGRATIONS_DIR}/${f}`, "utf8");

// ── The grandfather list: migrations that predate the four-path rule ───────────────────────────
//
// Frozen. Every file here is only required to have its functions registered. A file NOT on this
// list that creates a `public` function must name PUBLIC, anon, authenticated and service_role.
// The list may shrink (a file is deleted or brought up to the rule); the ratchet below forbids it
// from growing, because growing it is how a rule quietly stops applying.
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

test("[PRIVILEGE-REGISTRY] the grandfather list is a ratchet: it may shrink, never grow", () => {
  assert.ok(GRANDFATHERED.size <= GRANDFATHERED_CEILING,
    `the grandfather list grew to ${GRANDFATHERED.size}; a new function-creating migration must name all four grant paths instead`);
  for (const f of GRANDFATHERED) assert.ok(files.includes(f), `${f} is grandfathered but no longer on disk — remove it from the list`);
});

// ── Gate 1: every function a migration creates has a registry row; new files name four paths ──

test("[PRIVILEGE-REGISTRY] every public function a migration creates or replaces has a registry row", () => {
  const dropped = new Set(index.droppedIn.keys());
  const findings = files.flatMap((f) =>
    checkMigration(f, read(f), REGISTRY, { grandfathered: GRANDFATHERED.has(f), dropped })
      .filter((x) => x.problem === "no_registry_entry"));
  assert.deepEqual(findings.map((x) => `${x.file}: ${x.signature}`), [],
    "these functions are created by a migration but have no row in scripts/privilege-registry.ts — " +
    "a function nobody has decided about is the shape that let the refund writers stay open");
});

test("[PRIVILEGE-REGISTRY] a migration outside the grandfather list names all four default grant paths per function", () => {
  const findings = files.flatMap((f) =>
    checkMigration(f, read(f), REGISTRY, { grandfathered: GRANDFATHERED.has(f) })
      .filter((x) => x.problem === "default_paths_not_handled"));
  assert.deepEqual(findings.map((x) => `${x.file}: ${x.signature} does not name ${x.missing!.join(", ")}`), [],
    "Supabase grants anon, authenticated and service_role BY NAME on every new function, and the built-in default " +
    "grants PUBLIC. A REVOKE FROM PUBLIC alone leaves the three named grants standing. Name all four, " +
    "in a REVOKE or a GRANT, for every function the migration creates. (Text check, early warning only: " +
    "the SQL seam and docs/PRIVILEGE_ORACLE.sql ask the catalog.)");
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
  assert.deepEqual(by("public.answer_mollie_refund(uuid, text, text, numeric)").intent, { anon: "DENY", authenticated: "UNKNOWN", serviceRole: "ALLOW", public: "DENY" });
  assert.deepEqual(by("public.mollie_refund_reason_of(text)").intent, { anon: "DENY", authenticated: "DENY", serviceRole: "ALLOW", public: "DENY" });
  for (const t of ["clients", "documents", "folders", "invoices"]) {
    const e = by(`public.search_${t}_fuzzy(text)`);
    assert.equal(e.intent.anon, "DENY");
    assert.equal(e.intent.authenticated, "ALLOW");
    assert.equal(e.intent.serviceRole, "ALLOW");
  }
  const acting = by("public.acting_for_owner()");
  assert.equal(acting.intent.anon, "UNKNOWN");
  assert.equal(acting.intent.authenticated, "ALLOW");
  assert.equal(acting.intent.serviceRole, "ALLOW");
  const client = by("public.is_my_accountant_client(uuid)");
  assert.equal(client.intent.anon, "ALLOW", "five policies are TO public; revoking anon broke production once");
  assert.deepEqual(by("public.get_accountant_for_zzper(uuid)").intent, { anon: "UNKNOWN", authenticated: "UNKNOWN", serviceRole: "UNKNOWN", public: "UNKNOWN" });
});

test("[PRIVILEGE-REGISTRY] the counts are pinned, so changing an UNKNOWN or a deviation is a visible act", () => {
  assert.equal(liveEntries().length, 52, "52 postgres-owned functions in public were measured: 36 SECURITY DEFINER + 16 INVOKER");
  assert.equal(liveEntries().filter((e) => e.definer).length, 36);
  assert.equal(unknownCount(), 40);
  assert.equal(acceptedDeviationCount(), 22);
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

const FAKE: FunctionEntry = {
  signature: "public.known_fn(uuid, integer)", kind: "server_rpc", managedBy: "boekbrug", owner: "postgres", definer: true,
  status: "live", intent: { anon: "DENY", authenticated: "DENY", serviceRole: "ALLOW", public: "DENY" },
  current: { anon: false, authenticated: false, serviceRole: true, publicEntry: false, aclMd5: "0".repeat(32) },
  evidence: ["synthetic"], callers: ["synthetic"], provenance: { inRepo: true, productionVersions: [] }, verified: { at: "2026-01-01", source: "synthetic" },
};

test("[PRIVILEGE-REGISTRY][MUTATION] a migration creating an unregistered function is caught", () => {
  const sql = `CREATE OR REPLACE FUNCTION public.brand_new(p_user_id uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
    REVOKE ALL ON FUNCTION public.brand_new(uuid) FROM PUBLIC, anon, authenticated, service_role;`;
  const f = checkMigration("x.sql", sql, [FAKE], { grandfathered: false });
  assert.deepEqual(f.map((x) => x.problem), ["no_registry_entry"]);
  assert.equal(f[0].signature, "public.brand_new(uuid)");
});

test("[PRIVILEGE-REGISTRY][MUTATION] the refund-writer shape — REVOKE FROM PUBLIC alone — is caught on a new migration", () => {
  const sql = `CREATE FUNCTION public.known_fn(p_user_id uuid, p_n int) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
    REVOKE ALL ON FUNCTION public.known_fn(uuid, int) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.known_fn(uuid, int) TO service_role;`;
  const f = checkMigration("x.sql", sql, [FAKE], { grandfathered: false });
  assert.deepEqual(f.map((x) => x.problem), ["default_paths_not_handled"]);
  assert.deepEqual(f[0].missing, ["anon", "authenticated"], "PUBLIC and service_role were named; anon and authenticated were not");
  // …and the same file is accepted once it names them.
  const fixed = sql + "\n    REVOKE ALL ON FUNCTION public.known_fn(uuid, int) FROM anon, authenticated;";
  assert.deepEqual(checkMigration("x.sql", fixed, [FAKE], { grandfathered: false }), []);
  // …and the rule is suspended, but registration is not, for a grandfathered file.
  assert.deepEqual(checkMigration("x.sql", sql, [FAKE], { grandfathered: true }), []);
  assert.equal(checkMigration("x.sql", sql, [], { grandfathered: true }).length, 1);
});

test("[PRIVILEGE-REGISTRY][MUTATION] a REVOKE written in a comment counts for nothing", () => {
  const sql = `CREATE FUNCTION public.known_fn(p uuid, n integer) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
    -- REVOKE ALL ON FUNCTION public.known_fn(uuid, integer) FROM PUBLIC, anon, authenticated, service_role;
    /* GRANT EXECUTE ON FUNCTION public.known_fn(uuid, integer) TO anon; */`;
  const f = checkMigration("x.sql", sql, [FAKE], { grandfathered: false });
  assert.deepEqual(f[0]?.missing, ["anon", "authenticated", "serviceRole", "public"]);
});

test("[PRIVILEGE-REGISTRY][MUTATION] the DO-loop shape (rpc_anon_revoke.sql) is recognised, and only with a format('REVOKE …')", () => {
  const loop = `CREATE FUNCTION public.known_fn(p uuid, n integer) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
    DO $$ DECLARE fn text; sig text; BEGIN
      FOREACH fn IN ARRAY ARRAY['known_fn'] LOOP
        FOR sig IN SELECT format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)) FROM pg_proc p WHERE p.proname = fn LOOP
          EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', sig);
          EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', sig);
          EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
        END LOOP; END LOOP; END $$;`;
  assert.deepEqual([...grantPathsHandled(loop, "known_fn")].sort(), ["anon", "authenticated", "public", "serviceRole"]);
  // The name in a string literal without any format('REVOKE …') is just a string.
  assert.equal(grantPathsHandled(`SELECT 'known_fn'; REVOKE ALL ON FUNCTION public.other(uuid) FROM anon;`, "known_fn").size, 0);
  // A REVOKE on ANOTHER function does not count for this one.
  assert.equal(grantPathsHandled(`REVOKE ALL ON FUNCTION public.other_fn(uuid) FROM PUBLIC, anon, authenticated, service_role;`, "known_fn").size, 0);
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
  // Every live function is present, and a function is present once.
  for (const e of REGISTRY) assert.equal(sql.split(`('${e.signature}',`).length - 1, 1, e.signature);
  // The ACL-shaping files are real files: a made-up name would make every comparison PARTIAL forever.
  for (const m of sql.matchAll(/ARRAY\[([^\]]+)\]::text\[\]/g)) {
    for (const f of m[1].split(",")) assert.ok(files.includes(f.trim().replace(/^'|'$/g, "")), `${f} is named as an ACL-shaping migration but does not exist`);
  }
});

test("[PRIVILEGE-REGISTRY][MUTATION] an entry whose repo provenance is wrong is caught either way", () => {
  // Says "in repo" for a function no file creates…
  const ghost: FunctionEntry = { ...FAKE, signature: "public.nobody_creates_me()" };
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
