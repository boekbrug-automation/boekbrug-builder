// scripts/privilege-oracle.ts
// [PRIVILEGE-REGISTRY] The logic around the registry: read migrations, check them, and generate the
// two artefacts that compare the registry with a real catalog.
//
//   npx tsx scripts/privilege-oracle.ts --write
//     writes tests/sql/privilege-intent.sql (the seam's copy of the intent)
//     and    docs/PRIVILEGE_ORACLE.sql      (the production verification queries)
//
// Everything here is pure and importable, so src/lib/privilege-gates.test.ts can run the same
// functions over synthetic migration text and prove that they bite.
//
// ── THREE LAYERS, ONE ORACLE ──
//
// 1. The repo gate reads migration TEXT. It can require that a function has a registry row and
//    that a new migration names all four default grant paths. It cannot see what the database
//    did with that text: CREATE OR REPLACE keeps an existing ACL, a migration applied through the
//    MCP path has no file here, and a REVOKE inside a DO block is a string until it runs.
//    Early warning only, and it says so in its own failure messages.
// 2. The SQL seam runs the migration on a real PostgreSQL that reproduces Supabase's default
//    grants and then asks the catalog (has_function_privilege) — for the migrations a test loads.
// 3. The production oracle asks the production catalog. That is the final answer.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import {
  ACKNOWLEDGED_PRODUCTION_MIGRATIONS, EXPECTED_FUNCTION_DEFAULT_ACL, GRANTEES, PLATFORM_CLASSES, REGISTRY,
  acceptedDeviationCount, nameOf, unknownCount,
  type Decision, type FunctionEntry, type Grantee,
} from "./privilege-registry";

export const MIGRATIONS_DIR = "supabase/migrations";
export const INTENT_SQL_PATH = "tests/sql/privilege-intent.sql";
export const ORACLE_SQL_PATH = "docs/PRIVILEGE_ORACLE.sql";

// ── SQL text helpers ───────────────────────────────────────────────────────────────────────────

/** SQL comments removed. Commented-out DDL is not DDL, and a marker inside a comment is not a bound. */
export function stripSql(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

/**
 * PostgreSQL's own spelling of a type, as oidvectortypes() prints it. The registry is keyed on
 * that spelling so that a REVOKE written as `(uuid,int,text)` and a catalog row printed as
 * `(uuid, integer, text)` meet on one string.
 */
const TYPE_ALIASES: Record<string, string> = {
  int: "integer", int4: "integer", integer: "integer",
  int8: "bigint", bigint: "bigint",
  int2: "smallint", smallint: "smallint",
  bool: "boolean", boolean: "boolean",
  float8: "double precision", "double precision": "double precision",
  float4: "real", real: "real",
  decimal: "numeric", numeric: "numeric",
  timestamptz: "timestamp with time zone", "timestamp with time zone": "timestamp with time zone",
  timestamp: "timestamp without time zone", "timestamp without time zone": "timestamp without time zone",
  varchar: "character varying", "character varying": "character varying",
  char: "character", character: "character",
};

export function normaliseType(raw: string): string {
  let t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  let array = "";
  // `text[]`, `text []`, `text ARRAY`
  const arr = /^(.*?)\s*(\[\s*\]|\barray\b)+$/.exec(t);
  if (arr) { t = arr[1].trim(); array = "[]"; }
  t = t.replace(/\s*\([^)]*\)\s*$/, "");          // typmod: numeric(12,2), varchar(40)
  t = t.replace(/^public\./, "");                   // public.invoices → invoices
  t = TYPE_ALIASES[t] ?? t;
  return t + array;
}

const MODE_WORDS = new Set(["in", "out", "inout", "variadic"]);

/**
 * One argument declaration → its identity type, or null when it is an OUT parameter (which is not
 * part of the identity signature). `p_user_id uuid DEFAULT null` → `uuid`.
 */
export function identityTypeOfArgument(arg: string): string | null {
  let a = arg.trim();
  if (!a) return null;
  a = a.replace(/\s+(default|=)\s+[\s\S]*$/i, "");
  const tokens = a.split(/\s+/);
  let mode = "in";
  if (MODE_WORDS.has(tokens[0].toLowerCase())) mode = tokens.shift()!.toLowerCase();
  if (mode === "out") return null;
  // Every parameter in this repository is named; the name is the first token, the type is the rest
  // (types can be several words: `timestamp with time zone`). A lone token is an unnamed type.
  const type = tokens.length >= 2 ? tokens.slice(1).join(" ") : tokens[0];
  return normaliseType(type);
}

/** Split on top-level commas only: `numeric(12,2)` and `DEFAULT ARRAY['a','b']` stay whole. */
function splitTopLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0, quote: string | null = null, cur = "";
  for (const ch of list) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === "(" || ch === "[") depth += 1;
    if (ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export interface CreatedFunction {
  /** Type-only identity signature, e.g. `public.next_invoice_seq(uuid, integer, text)`. */
  signature: string;
  name: string;
  replace: boolean;
  definer: boolean;
}

/**
 * Every `public` function a piece of SQL creates or replaces, with its identity signature.
 * Functions in other schemas are ignored; a function without a schema prefix is `public`.
 */
export function functionsCreatedBy(sql: string): CreatedFunction[] {
  const text = stripSql(sql);
  const out: CreatedFunction[] = [];
  const re = /create\s+(or\s+replace\s+)?function\s+(?:"?([a-z0-9_]+)"?\.)?"?([a-z0-9_]+)"?\s*\(/gi;
  for (const m of text.matchAll(re)) {
    const schema = (m[2] ?? "public").toLowerCase();
    if (schema !== "public") continue;
    // Walk to the matching close paren; argument lists nest (typmods, DEFAULT expressions).
    let i = m.index! + m[0].length, depth = 1, quote: string | null = null;
    const start = i;
    for (; i < text.length && depth > 0; i += 1) {
      const ch = text[i];
      if (quote) { if (ch === quote) quote = null; continue; }
      if (ch === "'" || ch === '"') { quote = ch; continue; }
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
    }
    const args = text.slice(start, i - 1);
    const types = splitTopLevel(args).map(identityTypeOfArgument).filter((t): t is string => t !== null);
    // SECURITY DEFINER belongs to THIS definition: look only until the body starts.
    const head = text.slice(i, i + 4000);
    const bodyAt = head.search(/\bas\s+\$|\bbegin\s+atomic\b/i);
    const options = bodyAt >= 0 ? head.slice(0, bodyAt) : head;
    out.push({
      signature: `public.${m[3].toLowerCase()}(${types.join(", ")})`,
      name: m[3].toLowerCase(),
      replace: Boolean(m[1]),
      definer: /\bsecurity\s+definer\b/i.test(options),
    });
  }
  return out;
}

/** Every `public` function a piece of SQL drops. `DROP FUNCTION IF EXISTS public.x(uuid)` → `x`. */
export function functionsDroppedBy(sql: string): string[] {
  const text = stripSql(sql);
  const out: string[] = [];
  for (const m of text.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:"?([a-z0-9_]+)"?\.)?"?([a-z0-9_]+)"?/gi)) {
    if ((m[1] ?? "public").toLowerCase() !== "public") continue;
    out.push(m[2].toLowerCase());
  }
  return out;
}

// ── The four default grant paths ───────────────────────────────────────────────────────────────

/** The grantee spellings a GRANT/REVOKE names, mapped onto the registry's four. */
const GRANTEE_WORDS: Record<string, Grantee> = {
  public: "public", anon: "anon", authenticated: "authenticated", service_role: "serviceRole",
};

/**
 * Which of the four default grant paths a piece of SQL explicitly handles for a function, by
 * naming that role in a GRANT or REVOKE on that function. Two shapes are recognised:
 *
 *   REVOKE ALL ON FUNCTION public.f(uuid) FROM PUBLIC, anon;           -- direct
 *   … 'f' … EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', sig)  -- the DO-loop shape
 *
 * The second is how rpc_anon_revoke.sql revokes by looked-up signature. A file that mentions the
 * function name only in a string literal but carries no format('GRANT|REVOKE …') is not counted.
 */
export function grantPathsHandled(sql: string, functionName: string): Set<Grantee> {
  const text = stripSql(sql);
  const handled = new Set<Grantee>();
  const fn = functionName.toLowerCase();

  const direct = new RegExp(
    String.raw`\b(grant|revoke)\b[^;]*?\bon\s+function\s+(?:"?public"?\.)?"?${fn}"?\s*\([^)]*\)\s*(?:to|from)\s+([^;]+);`, "gi");
  for (const m of text.matchAll(direct)) {
    for (const word of m[2].split(",")) {
      const g = GRANTEE_WORDS[word.trim().toLowerCase().replace(/^"|"$/g, "")];
      if (g) handled.add(g);
    }
  }

  if (new RegExp(String.raw`'${fn}'`, "i").test(text)) {
    for (const m of text.matchAll(/format\(\s*'(grant|revoke)\b[^']*?\b(?:to|from)\s+([a-z_, ]+)'/gi)) {
      for (const word of m[2].split(",")) {
        const g = GRANTEE_WORDS[word.trim().toLowerCase()];
        if (g) handled.add(g);
      }
    }
  }
  return handled;
}

export const ALL_GRANTEES: readonly Grantee[] = GRANTEES;

export interface MigrationFinding {
  file: string;
  signature: string;
  problem: "no_registry_entry" | "default_paths_not_handled";
  missing?: Grantee[];
}

/**
 * The repo gate over one migration's text. `grandfathered` files predate the four-path rule and
 * are only required to be registered; every other file must handle all four paths per function
 * it creates. `dropped` names functions some migration drops, so a created-then-dropped function
 * needs no registry row.
 */
export function checkMigration(
  file: string, sql: string, registry: readonly FunctionEntry[], opts: { grandfathered: boolean; dropped?: ReadonlySet<string> },
): MigrationFinding[] {
  const known = new Set(registry.map((e) => e.signature));
  const findings: MigrationFinding[] = [];
  for (const f of functionsCreatedBy(sql)) {
    if (!known.has(f.signature) && !opts.dropped?.has(f.name)) {
      findings.push({ file, signature: f.signature, problem: "no_registry_entry" });
    }
    if (!opts.grandfathered) {
      const handled = grantPathsHandled(sql, f.name);
      const missing = ALL_GRANTEES.filter((g) => !handled.has(g));
      if (missing.length) findings.push({ file, signature: f.signature, problem: "default_paths_not_handled", missing });
    }
  }
  return findings;
}

// ── Reading the migrations directory ───────────────────────────────────────────────────────────

export function migrationFiles(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
}

export interface MigrationIndex {
  /** file → functions it creates */
  creates: Map<string, CreatedFunction[]>;
  /** function name → files that create it */
  createdIn: Map<string, string[]>;
  /** function name → files that drop it */
  droppedIn: Map<string, string[]>;
  /** function name → files whose GRANT/REVOKE statements name it (the files that shape its ACL) */
  aclShapedBy: Map<string, string[]>;
}

export function indexMigrations(dir = MIGRATIONS_DIR): MigrationIndex {
  const creates = new Map<string, CreatedFunction[]>();
  const createdIn = new Map<string, string[]>();
  const droppedIn = new Map<string, string[]>();
  const aclShapedBy = new Map<string, string[]>();
  const names = new Set(REGISTRY.map((e) => nameOf(e.signature)));
  const push = (map: Map<string, string[]>, key: string, file: string) => {
    const list = map.get(key) ?? [];
    if (!list.includes(file)) list.push(file);
    map.set(key, list);
  };
  for (const file of migrationFiles(dir)) {
    const sql = readFileSync(`${dir}/${file}`, "utf8");
    const fns = functionsCreatedBy(sql);
    creates.set(file, fns);
    for (const f of fns) { push(createdIn, f.name, file); names.add(f.name); }
    for (const d of functionsDroppedBy(sql)) push(droppedIn, d, file);
  }
  // A second pass, so functions known only from the registry (no creating file) are looked up too.
  for (const file of migrationFiles(dir)) {
    const sql = readFileSync(`${dir}/${file}`, "utf8");
    if (!/\b(grant|revoke)\b/i.test(stripSql(sql))) continue;
    for (const n of names) if (grantPathsHandled(sql, n).size > 0) push(aclShapedBy, n, file);
  }
  return { creates, createdIn, droppedIn, aclShapedBy };
}

// ── Rendering: shared SQL fragments ────────────────────────────────────────────────────────────

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const dec = (d: Decision) => lit(d);
const optLit = (s: string | undefined) => (s === undefined ? "NULL" : lit(s));
const textArray = (items: readonly string[]) => (items.length ? `ARRAY[${items.map(lit).join(",")}]::text[]` : "ARRAY[]::text[]");

/** The live catalog, as both the seam and the oracle read it. One definition, so they cannot drift. */
export const LIVE_FUNCTIONS_SQL = `
  SELECT format('public.%I(%s)', p.proname, oidvectortypes(p.proargtypes)) AS sig,
         p.oid,
         pg_get_userbyid(p.proowner)                              AS owner,
         p.prosecdef                                              AS definer,
         has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_x,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_x,
         has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role_x,
         (p.proacl IS NULL OR EXISTS (
            SELECT 1 FROM aclexplode(p.proacl) e WHERE e.grantee = 0 AND e.privilege_type = 'EXECUTE'))
                                                                  AS public_x,
         md5(coalesce(p.proacl::text, '<null>'))                  AS acl_md5
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'`;

function intentRowsSql(entries: readonly FunctionEntry[], index: MigrationIndex | null): string {
  return entries.map((e) => {
    const dev = e.acceptedDeviations ?? {};
    const acl = index ? (index.aclShapedBy.get(nameOf(e.signature)) ?? []) : [];
    return `  (${[
      lit(e.signature), lit(e.kind), lit(e.status), e.definer ? "true" : "false",
      dec(e.intent.anon), dec(e.intent.authenticated), dec(e.intent.serviceRole), dec(e.intent.public),
      optLit(dev.anon), optLit(dev.authenticated), optLit(dev.serviceRole), optLit(dev.public),
      textArray(acl),
    ].join(", ")})`;
  }).join(",\n");
}

const INTENT_COLUMNS = "sig, kind, status, definer, i_anon, i_authenticated, i_service_role, i_public, " +
  "dev_anon, dev_authenticated, dev_service_role, dev_public, acl_files";

// ── Rendering: the seam's intent table ─────────────────────────────────────────────────────────

export function renderIntentSql(index: MigrationIndex): string {
  return `-- tests/sql/privilege-intent.sql
-- [PRIVILEGE-REGISTRY] GENERATED from scripts/privilege-registry.ts — do not edit by hand.
-- Regenerate with:  npx tsx scripts/privilege-oracle.ts --write
--
-- The registry's intent, as a temp table the SQL seam can join against the real catalog after a
-- test's migrations have run. acl_files lists the repo migrations whose GRANT/REVOKE statements
-- shape that function's privileges; a comparison is HARD only when every one of them was loaded,
-- and reported as partial otherwise (see tests/sql/privilege-check.sql).
--
-- UNKNOWN is a value here, not a boolean: the check never turns it into a pass or a fail.

DROP TABLE IF EXISTS privilege_intent;
CREATE TEMP TABLE privilege_intent (
  sig               text PRIMARY KEY,
  kind              text NOT NULL,
  status            text NOT NULL,
  definer           boolean NOT NULL,
  i_anon            text NOT NULL CHECK (i_anon IN ('ALLOW','DENY','UNKNOWN')),
  i_authenticated   text NOT NULL CHECK (i_authenticated IN ('ALLOW','DENY','UNKNOWN')),
  i_service_role    text NOT NULL CHECK (i_service_role IN ('ALLOW','DENY','UNKNOWN')),
  i_public          text NOT NULL CHECK (i_public IN ('ALLOW','DENY','UNKNOWN')),
  dev_anon          text,
  dev_authenticated text,
  dev_service_role  text,
  dev_public        text,
  acl_files         text[] NOT NULL
);

INSERT INTO privilege_intent (${INTENT_COLUMNS}) VALUES
${intentRowsSql(REGISTRY, index)};
`;
}

// ── Rendering: the production oracle ───────────────────────────────────────────────────────────

export function renderOracleSql(index: MigrationIndex, repoFiles: readonly string[] = migrationFiles()): string {
  const live = REGISTRY.filter((e) => e.status === "live");
  const repoNames = repoFiles.map((f) => f.replace(/\.sql$/, ""));
  const ack = ACKNOWLEDGED_PRODUCTION_MIGRATIONS;
  const platform = PLATFORM_CLASSES;

  return `-- docs/PRIVILEGE_ORACLE.sql
-- [PRIVILEGE-REGISTRY] GENERATED from scripts/privilege-registry.ts — do not edit by hand.
-- Regenerate with:  npx tsx scripts/privilege-oracle.ts --write
--
-- READ ONLY. Every block below is a SELECT over the catalog. Nothing here grants, revokes, alters
-- or writes. Run each numbered block on its own in the Supabase SQL editor (or through a
-- read-only tool) and read the verdict column.
--
-- WHY THE CATALOG AND NOT THE MIGRATION FILE. A migration that revoked PUBLIC still left anon with
-- EXECUTE on two money-writing functions, because Supabase grants anon by NAME on every new
-- function and a REVOKE FROM PUBLIC does not touch a named grantee. Two of those functions existed
-- only in production's migration history, never in this repository. The file cannot answer "who
-- can call this today?". has_function_privilege can.
--
-- WHAT THE VERDICTS MEAN
--   ok                      effective privilege equals the registry intent
--   UNKNOWN(t|f)            the registry has no decision yet; the actual value is shown, nothing passes or fails
--   ACCEPTED_DEVIATION      reality differs from intent, and the registry records why it is left for now
--   DRIFT                   reality differs from intent and nothing in the registry accounts for it → act
--   MISSING                 the registry names a live function the catalog does not have
--   UNREGISTERED            a postgres-owned function in public with no registry row
-- The acl_md5 column is forensic only: it changes when ACL entries are reordered, which is not a
-- privilege change. Never read it as pass or fail.
--
-- Registry at generation time: ${live.length} live functions, ${unknownCount()} UNKNOWN decisions, ${acceptedDeviationCount()} accepted deviations.

-- ═══ 1. PER FUNCTION: registry intent ↔ effective privileges ═══════════════════════════════════

WITH intent(${INTENT_COLUMNS}) AS (VALUES
${intentRowsSql(live, null)}
),
live AS (${LIVE_FUNCTIONS_SQL}
),
joined AS (
  SELECT coalesce(i.sig, l.sig) AS sig, i.kind, i.definer AS i_definer,
         i.i_anon, i.i_authenticated, i.i_service_role, i.i_public,
         i.dev_anon, i.dev_authenticated, i.dev_service_role, i.dev_public,
         l.owner, l.definer AS l_definer, l.anon_x, l.authenticated_x, l.service_role_x, l.public_x, l.acl_md5,
         (i.sig IS NOT NULL) AS registered, (l.sig IS NOT NULL) AS present
    FROM intent i
    FULL OUTER JOIN live l ON l.sig = i.sig
   WHERE i.sig IS NOT NULL OR l.owner = 'postgres'
),
verdicts AS (
  SELECT sig, kind, registered, present, owner, l_definer, i_definer, acl_md5,
         anon_x, authenticated_x, service_role_x, public_x,
         CASE WHEN i_anon = 'UNKNOWN' THEN 'UNKNOWN(' || anon_x::text || ')'
              WHEN (i_anon = 'ALLOW') = anon_x THEN 'ok'
              WHEN dev_anon IS NOT NULL THEN 'ACCEPTED_DEVIATION' ELSE 'DRIFT' END AS v_anon,
         CASE WHEN i_authenticated = 'UNKNOWN' THEN 'UNKNOWN(' || authenticated_x::text || ')'
              WHEN (i_authenticated = 'ALLOW') = authenticated_x THEN 'ok'
              WHEN dev_authenticated IS NOT NULL THEN 'ACCEPTED_DEVIATION' ELSE 'DRIFT' END AS v_authenticated,
         CASE WHEN i_service_role = 'UNKNOWN' THEN 'UNKNOWN(' || service_role_x::text || ')'
              WHEN (i_service_role = 'ALLOW') = service_role_x THEN 'ok'
              WHEN dev_service_role IS NOT NULL THEN 'ACCEPTED_DEVIATION' ELSE 'DRIFT' END AS v_service_role,
         CASE WHEN i_public = 'UNKNOWN' THEN 'UNKNOWN(' || public_x::text || ')'
              WHEN (i_public = 'ALLOW') = public_x THEN 'ok'
              WHEN dev_public IS NOT NULL THEN 'ACCEPTED_DEVIATION' ELSE 'DRIFT' END AS v_public,
         CASE WHEN owner IS NULL THEN NULL WHEN owner = 'postgres' THEN 'ok' ELSE 'DRIFT(owner=' || owner || ')' END AS v_owner,
         CASE WHEN l_definer IS NULL OR i_definer IS NULL THEN NULL
              WHEN l_definer = i_definer THEN 'ok' ELSE 'DRIFT(definer=' || l_definer::text || ')' END AS v_definer
    FROM joined
)
SELECT sig,
       CASE WHEN NOT registered THEN 'UNREGISTERED'
            WHEN NOT present    THEN 'MISSING'
            WHEN 'DRIFT' IN (v_anon, v_authenticated, v_service_role, v_public)
              OR v_owner LIKE 'DRIFT%' OR v_definer LIKE 'DRIFT%' THEN 'DRIFT'
            WHEN 'ACCEPTED_DEVIATION' IN (v_anon, v_authenticated, v_service_role, v_public) THEN 'ACCEPTED_DEVIATION'
            WHEN v_anon LIKE 'UNKNOWN%' OR v_authenticated LIKE 'UNKNOWN%'
              OR v_service_role LIKE 'UNKNOWN%' OR v_public LIKE 'UNKNOWN%' THEN 'ok (with UNKNOWN)'
            ELSE 'ok' END AS verdict,
       kind, v_anon, v_authenticated, v_service_role, v_public, v_owner, v_definer,
       anon_x, authenticated_x, service_role_x, public_x, acl_md5 AS acl_md5_forensic_only
  FROM verdicts
 ORDER BY CASE WHEN NOT registered THEN 0 WHEN NOT present THEN 1 ELSE 2 END, sig;

-- ═══ 2. SET LEVEL: the things a per-function row cannot see ══════════════════════════════════════
-- One row per finding. An empty result is the pass. The last row is always a summary line, so an
-- empty result and a query that did not run are not the same thing.

WITH live AS (${LIVE_FUNCTIONS_SQL}
),
registered(sig) AS (VALUES
${live.map((e) => `  (${lit(e.signature)})`).join(",\n")}
),
platform_class(owner, extension) AS (VALUES
${platform.map((p) => `  (${lit(p.owner)}, ${lit(p.extension)})`).join(",\n")}
),
ext_member AS (
  SELECT d.objid AS oid, e.extname
    FROM pg_depend d
    JOIN pg_extension e ON e.oid = d.refobjid
   WHERE d.classid = 'pg_proc'::regclass AND d.deptype = 'e'
),
expected_default_acl(for_role, in_schema, entries) AS (VALUES
${EXPECTED_FUNCTION_DEFAULT_ACL.map((r) => `  (${lit(r.forRole)}, ${lit(r.schema)}, ${textArray([...r.entries].sort())})`).join(",\n")}
),
actual_default_acl AS (
  SELECT pg_get_userbyid(d.defaclrole)::text AS for_role, coalesce(n.nspname, '<global>') AS in_schema,
         (SELECT array_agg(x ORDER BY x) FROM unnest(d.defaclacl::text::text[]) AS x) AS entries
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
   WHERE d.defaclobjtype = 'f'
),
findings AS (
  -- 2a. a postgres-owned function in public with no registry row
  SELECT 'UNREGISTERED_FUNCTION' AS finding, l.sig AS subject,
         'owner=' || l.owner || ' definer=' || l.definer::text || ' anon=' || l.anon_x::text AS detail
    FROM live l LEFT JOIN registered r ON r.sig = l.sig
   WHERE l.owner = 'postgres' AND r.sig IS NULL
  UNION ALL
  -- 2b. a platform-owned function in public that no named extension installed
  SELECT 'UNEXPECTED_PLATFORM_FUNCTION', l.sig,
         'owner=' || l.owner || ' extension=' || coalesce(m.extname, '<none>')
    FROM live l
    LEFT JOIN ext_member m ON m.oid = l.oid
   WHERE l.owner <> 'postgres'
     AND NOT EXISTS (SELECT 1 FROM platform_class pc WHERE pc.owner = l.owner AND pc.extension = m.extname)
  UNION ALL
  -- 2c. a platform-managed function that is SECURITY DEFINER
  SELECT 'PLATFORM_FUNCTION_IS_DEFINER', l.sig, 'owner=' || l.owner
    FROM live l JOIN ext_member m ON m.oid = l.oid
    JOIN platform_class pc ON pc.owner = l.owner AND pc.extension = m.extname
   WHERE l.definer
  UNION ALL
  -- 2d. the function-type default ACL rows differ from the recorded shape (compared as sets)
  SELECT 'DEFAULT_ACL_DRIFT', coalesce(e.for_role, a.for_role) || ' / ' || coalesce(e.in_schema, a.in_schema),
         'expected=' || coalesce(e.entries::text, '<no row>') || ' actual=' || coalesce(a.entries::text, '<no row>')
    FROM expected_default_acl e
    FULL OUTER JOIN actual_default_acl a ON a.for_role = e.for_role AND a.in_schema = e.in_schema
   WHERE e.entries IS DISTINCT FROM a.entries
  UNION ALL
  -- 2e. the linter's rule 0028, computed here: a SECURITY DEFINER function anon can execute while
  --     the registry says DENY. Cross-check afterwards with the Supabase advisor: every function
  --     it names under 0028 must appear in block 1 with i_anon = ALLOW or UNKNOWN.
  SELECT 'ANON_EXECUTES_DEFINER_AGAINST_INTENT', l.sig,
         coalesce('accepted deviation: ' || deny.deviation, 'registry intent anon = DENY and NO deviation recorded → DRIFT')
    FROM live l
    JOIN (VALUES
${live.filter((e) => e.intent.anon === "DENY").map((e) => `      (${lit(e.signature)}, ${optLit(e.acceptedDeviations?.anon)})`).join(",\n")}
    ) AS deny(sig, deviation) ON deny.sig = l.sig
   WHERE l.definer AND l.anon_x
)
SELECT finding, subject, detail FROM findings
UNION ALL
SELECT 'SUMMARY', 'findings above: ' || count(*)::text,
       'live public functions: ' || (SELECT count(*) FROM live)::text ||
       ', postgres-owned: ' || (SELECT count(*) FROM live WHERE owner = 'postgres')::text ||
       ', platform: ' || (SELECT count(*) FROM live WHERE owner <> 'postgres')::text
  FROM findings
ORDER BY 1, 2;

-- ═══ 3. PROVENANCE: production migration history ↔ this repository ═══════════════════════════════
-- A production migration that carries function or privilege DDL must have a versioned source here,
-- or an explicit acknowledgement in scripts/privilege-registry.ts. Anything else is DRIFT: a
-- function that exists only because something was applied outside the review path.
--   REPO           a file with the same name exists in supabase/migrations
--   ACKNOWLEDGED   listed in ACKNOWLEDGED_PRODUCTION_MIGRATIONS; the functions it creates are checked
--                  against that acknowledgement (mismatch → ACKNOWLEDGED_BUT_DIFFERENT)
--   DRIFT          neither
-- Rows with no function or privilege DDL are listed as 'not privilege-relevant' for completeness.

WITH repo(name) AS (VALUES
${repoNames.map((n) => `  (${lit(n)})`).join(",\n")}
),
acknowledged(version, name, repo_file, functions, reason) AS (VALUES
${ack.map((a) => `  (${lit(a.version)}, ${lit(a.name)}, ${optLit(a.repoFile ?? undefined)}, ${textArray(a.functions)}, ${lit(a.reason)})`).join(",\n")}
),
history AS (
  SELECT s.version, s.name,
         array_to_string(s.statements, E'\\n') AS sql_text,
         md5(array_to_string(s.statements, E'\\n')) AS statements_md5
    FROM supabase_migrations.schema_migrations s
),
classified AS (
  SELECT h.version, h.name, h.statements_md5,
         (h.sql_text ~* '(create\\s+(or\\s+replace\\s+)?function|\\mgrant\\M|\\mrevoke\\M|alter\\s+default\\s+privileges|security\\s+definer|alter\\s+function)') AS privilege_relevant,
         coalesce((SELECT array_agg(DISTINCT lower(m[1]) ORDER BY lower(m[1]))
                     FROM regexp_matches(h.sql_text, 'create\\s+(?:or\\s+replace\\s+)?function\\s+(?:public\\.)?([a-z0-9_]+)', 'gi') AS m),
                  ARRAY[]::text[]) AS creates_functions,
         (r.name IS NOT NULL) AS in_repo,
         a.repo_file, a.functions AS acknowledged_functions, a.reason
    FROM history h
    LEFT JOIN repo r ON r.name = h.name
    LEFT JOIN acknowledged a ON a.version = h.version
)
SELECT version, name,
       CASE WHEN NOT privilege_relevant THEN 'not privilege-relevant'
            WHEN in_repo AND reason IS NULL THEN 'REPO'
            WHEN reason IS NOT NULL AND creates_functions = acknowledged_functions THEN 'ACKNOWLEDGED'
            WHEN reason IS NOT NULL THEN 'ACKNOWLEDGED_BUT_DIFFERENT'
            ELSE 'DRIFT' END AS provenance,
       creates_functions, repo_file, reason, statements_md5
  FROM classified
 ORDER BY CASE WHEN NOT privilege_relevant THEN 2 WHEN in_repo OR reason IS NOT NULL THEN 1 ELSE 0 END, version;

-- ═══ 4. THE MEASURED BASELINE this registry was written against ═══════════════════════════════════
-- Effective privileges as recorded in scripts/privilege-registry.ts (field \`current\`). Block 1 is
-- the live truth; this block exists so a reader can see what the registry BELIEVED when a DRIFT
-- row appears, without opening the TypeScript.
--   sig | anon | authenticated | service_role | public entry | acl_md5 (forensic)
${live.map((e) => `--   ${e.signature} | ${e.current!.anon} | ${e.current!.authenticated} | ${e.current!.serviceRole} | ${e.current!.publicEntry} | ${e.current!.aclMd5}`).join("\n")}
`;
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────────

function main(args: string[]): void {
  const index = indexMigrations();
  if (args.includes("--write")) {
    writeFileSync(INTENT_SQL_PATH, renderIntentSql(index));
    writeFileSync(ORACLE_SQL_PATH, renderOracleSql(index));
    console.log(`wrote ${INTENT_SQL_PATH} and ${ORACLE_SQL_PATH}`);
    return;
  }
  if (args.includes("--index")) {
    for (const [file, fns] of index.creates) if (fns.length) console.log(file, "→", fns.map((f) => f.signature + (f.definer ? " [definer]" : "")).join("; "));
    console.log("\naclShapedBy:");
    for (const [n, files] of [...index.aclShapedBy].sort()) console.log(" ", n, "←", files.join(", "));
    console.log("\ndroppedIn:", [...index.droppedIn]);
    return;
  }
  console.log("usage: npx tsx scripts/privilege-oracle.ts --write | --index");
}

if (process.argv[1] && /privilege-oracle\.(ts|js|mts)$/.test(process.argv[1])) main(process.argv.slice(2));
