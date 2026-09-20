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

// ── SQL text: one lexer for everything ─────────────────────────────────────────────────────────
//
// Statement boundaries, comments, string literals, quoted identifiers and dollar-quoted bodies are
// decided by ONE lexer that follows PostgreSQL's own rules, and every reader below works on its
// regions. The first version had two hand-rolled scanners that disagreed with each other and with
// PostgreSQL — a `--` inside a `$$` body swallowed the closing delimiter, an `E'\''` desynchronised
// the quote state, a nested `/* /* */ … */` closed at the first `*/` — and each disagreement was a
// place where a GRANT could hide from the gate while still running in the database.

export type RegionKind = "code" | "string" | "ident" | "dollar" | "comment";

export interface Region {
  kind: RegionKind;
  start: number;
  /** exclusive */
  end: number;
  /** dollar regions: the delimiter, `$$` or `$tag$` */
  tag?: string;
}

const isIdentChar = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_]/.test(c);

/** The regions of a piece of SQL, in order and covering it completely. */
export function lexRegions(text: string): Region[] {
  const regions: Region[] = [];
  let i = 0, codeStart = 0;
  const closeCode = (at: number) => { if (at > codeStart) regions.push({ kind: "code", start: codeStart, end: at }); };
  while (i < text.length) {
    const ch = text[i], next = text[i + 1];
    if (ch === "-" && next === "-") {
      closeCode(i);
      let j = text.indexOf("\n", i);
      if (j === -1) j = text.length;
      regions.push({ kind: "comment", start: i, end: j });
      i = j; codeStart = i; continue;
    }
    if (ch === "/" && next === "*") {
      closeCode(i);
      let depth = 1, j = i + 2;
      while (j < text.length && depth > 0) {                       // PostgreSQL nests block comments
        if (text[j] === "/" && text[j + 1] === "*") { depth += 1; j += 2; continue; }
        if (text[j] === "*" && text[j + 1] === "/") { depth -= 1; j += 2; continue; }
        j += 1;
      }
      regions.push({ kind: "comment", start: i, end: j });
      i = j; codeStart = i; continue;
    }
    if (ch === "'") {
      closeCode(i);
      // E'…' honours backslash escapes; an ordinary string does not (standard_conforming_strings).
      const escapes = /[eE]/.test(text[i - 1] ?? "") && !isIdentChar(text[i - 2]);
      let j = i + 1;
      while (j < text.length) {
        if (escapes && text[j] === "\\") { j += 2; continue; }
        if (text[j] === "'") { if (text[j + 1] === "'") { j += 2; continue; } break; }
        j += 1;
      }
      j = Math.min(j + 1, text.length);
      regions.push({ kind: "string", start: i, end: j });
      i = j; codeStart = i; continue;
    }
    if (ch === '"') {
      closeCode(i);
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '"') { if (text[j + 1] === '"') { j += 2; continue; } break; }
        j += 1;
      }
      j = Math.min(j + 1, text.length);
      regions.push({ kind: "ident", start: i, end: j });
      i = j; codeStart = i; continue;
    }
    // A dollar quote opens only where an identifier could not continue: `x$a$y` is one identifier.
    if (ch === "$" && !isIdentChar(text[i - 1])) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i, i + 64));
      if (m) {
        closeCode(i);
        const tag = m[0];
        let j = text.indexOf(tag, i + tag.length);
        j = j === -1 ? text.length : j + tag.length;
        regions.push({ kind: "dollar", start: i, end: j, tag });
        i = j; codeStart = i; continue;
      }
    }
    i += 1;
  }
  closeCode(text.length);
  return regions;
}

/**
 * SQL comments removed, everything else verbatim — including dollar-quoted bodies, whose
 * contents PostgreSQL's outer lexer treats as opaque text. A reader that looks INSIDE a body
 * calls stripSql on the body itself.
 */
export function stripSql(sql: string): string {
  let out = "";
  for (const r of lexRegions(sql)) out += r.kind === "comment" ? " " : sql.slice(r.start, r.end);
  return out;
}

/** Code regions kept, every other region blanked to spaces of the same length, so offsets hold. */
function codeOnly(text: string): string {
  let out = "";
  for (const r of lexRegions(text)) out += r.kind === "code" ? text.slice(r.start, r.end) : " ".repeat(r.end - r.start);
  return out;
}

/** The text between a dollar region's delimiters. */
const dollarInner = (text: string, r: Region): string => text.slice(r.start + r.tag!.length, Math.max(r.start + r.tag!.length, r.end - r.tag!.length));

/** A single-quoted literal's content, with '' folded back to '. */
const stringInner = (text: string, r: Region): string => text.slice(r.start + 1, Math.max(r.start + 1, r.end - 1)).replace(/''/g, "'");

/**
 * Split SQL into top-level statements at semicolons that PostgreSQL would see as statement ends —
 * never inside a string, a quoted identifier, a comment or a dollar-quoted body. Each statement
 * comes with its offset in the input.
 */
export function splitStatements(text: string): { sql: string; at: number }[] {
  const out: { sql: string; at: number }[] = [];
  let start = 0;
  const push = (end: number) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const sql = raw.trim();
    if (sql) out.push({ sql, at: start + lead });
    start = end + 1;
  };
  for (const r of lexRegions(text)) {
    if (r.kind !== "code") continue;
    for (let k = r.start; k < r.end; k += 1) if (text[k] === ";") push(k);
  }
  push(text.length);
  return out;
}

// ── Types, as PostgreSQL prints them ───────────────────────────────────────────────────────────

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
  let depth = 0, cur = "", last = 0;
  const code = codeOnly(list);
  for (let i = 0; i < list.length; i += 1) {
    const ch = code[i];
    if (ch === "(" || ch === "[") depth += 1;
    if (ch === ")" || ch === "]") depth -= 1;
    if (ch === "," && depth === 0) { out.push(list.slice(last, i)); last = i + 1; }
  }
  cur = list.slice(last);
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * From an opening paren at `open`, the index just past its matching close paren, honouring
 * strings, quoted identifiers and dollar quotes inside the list. -1 when unbalanced.
 */
function matchingParen(text: string, open: number): number {
  const code = codeOnly(text.slice(open));
  let depth = 0;
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] === "(") depth += 1;
    else if (code[i] === ")") { depth -= 1; if (depth === 0) return open + i + 1; }
  }
  return -1;
}

/**
 * An identifier as it appears in SQL → the spelling the catalog prints. Unquoted folds to lower
 * case; a quoted identifier keeps its case and, when it is not a plain lower-case name, its quotes
 * (format('%I') prints `"Known_Fn"`).
 */
function identifierText(quoted: string | undefined, plain: string | undefined): string {
  if (plain !== undefined) return plain.toLowerCase();
  const q = quoted!.replace(/""/g, '"');
  return /^[a-z_][a-z0-9_]*$/.test(q) ? q : `"${q}"`;
}

const IDENT = String.raw`(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))`;

// ── What a migration creates and drops ─────────────────────────────────────────────────────────

export interface CreatedFunction {
  /** Type-only identity signature, e.g. `public.next_invoice_seq(uuid, integer, text)`. */
  signature: string;
  name: string;
  replace: boolean;
  definer: boolean;
  /** offset in the stripped text, so "dropped before it was created" is decidable */
  at: number;
}

export interface CreatesReading {
  created: CreatedFunction[];
  /** CREATE FUNCTION/PROCEDURE statements whose name or argument list could not be read */
  unreadable: string[];
}

const CREATE_RE = /\bcreate\s+(or\s+replace\s+)?(function|procedure)\b/gi;

/**
 * Every `public` function or procedure a piece of SQL creates or replaces, read from the CODE of
 * the file (a CREATE inside a string literal or a comment is not a CREATE; one inside a dollar-
 * quoted body is dynamic SQL and is reported by the privilege reader as unproven). A CREATE whose
 * name or argument list cannot be read is reported, never dropped.
 */
export function readCreates(sql: string): CreatesReading {
  const text = stripSql(sql);
  const code = codeOnly(text);
  const created: CreatedFunction[] = [];
  const unreadable: string[] = [];
  for (const m of code.matchAll(CREATE_RE)) {
    const headAt = m.index! + m[0].length;
    const head = new RegExp(String.raw`^\s+(?:${IDENT}\s*\.\s*)?${IDENT}\s*\(`, "i").exec(text.slice(headAt, headAt + 400));
    if (!head) { unreadable.push(`cannot read the function name after: ${text.slice(m.index!, m.index! + 80).replace(/\s+/g, " ")}`); continue; }
    const schema = head[1] !== undefined || head[2] !== undefined ? identifierText(head[1], head[2]) : "public";
    if (schema !== "public") continue;
    const name = identifierText(head[3], head[4]);
    const open = headAt + head[0].length - 1;
    const close = matchingParen(text, open);
    if (close === -1) { unreadable.push(`unbalanced argument list for ${name}`); continue; }
    const args = text.slice(open + 1, close - 1);
    const types = splitTopLevel(args).map(identityTypeOfArgument).filter((t): t is string => t !== null);
    // SECURITY DEFINER belongs to THIS definition: read the options up to where the body starts.
    const tail = text.slice(close, close + 4000);
    const bodyAt = codeOnly(tail).search(/\bas\b|\breturn\b|\bbegin\s+atomic\b/i);
    const options = bodyAt >= 0 ? tail.slice(0, bodyAt) : tail;
    created.push({
      signature: `public.${name}(${types.join(", ")})`,
      name,
      replace: Boolean(m[1]),
      definer: /\bsecurity\s+definer\b/i.test(codeOnly(options)),
      at: m.index!,
    });
  }
  return { created, unreadable };
}

/** Compatibility wrapper: the created functions alone. */
export function functionsCreatedBy(sql: string): CreatedFunction[] {
  return readCreates(sql).created;
}

/** Every `public` function a piece of SQL drops, with where. `DROP FUNCTION IF EXISTS a(uuid), b()` → a, b. */
export function dropsIn(sql: string): { name: string; at: number }[] {
  const text = stripSql(sql);
  const code = codeOnly(text);
  const out: { name: string; at: number }[] = [];
  for (const m of code.matchAll(/\bdrop\s+(function|procedure|routine)\s+(if\s+exists\s+)?/gi)) {
    // one or more `[schema.]name[(args)]`, comma separated
    let pos = m.index! + m[0].length;
    for (;;) {
      const item = new RegExp(String.raw`^\s*(?:${IDENT}\s*\.\s*)?${IDENT}\s*`, "i").exec(text.slice(pos, pos + 300));
      if (!item) break;
      const schema = item[1] !== undefined || item[2] !== undefined ? identifierText(item[1], item[2]) : "public";
      const name = identifierText(item[3], item[4]);
      if (schema === "public") out.push({ name, at: m.index! });
      pos += item[0].length;
      if (text[pos] === "(") { const close = matchingParen(text, pos); if (close === -1) break; pos = close; }
      const comma = /^\s*,/.exec(text.slice(pos, pos + 20));
      if (!comma) break;
      pos += comma[0].length;
    }
  }
  return out;
}

/** Compatibility wrapper: the dropped names alone. */
export function functionsDroppedBy(sql: string): string[] {
  return dropsIn(sql).map((d) => d.name);
}

// ── Reading GRANT / REVOKE statements, in order, with their direction ──────────────────────────
//
// The first version of this gate asked only whether a migration MENTIONED each of the four roles.
// That blesses `GRANT EXECUTE … TO anon` on a function whose registry intent is DENY, which is the
// exact decision the whole programme exists to refuse. So the statements are read in order, and
// what is compared with the registry is each role's FINAL explicit decision in the file.
//
// The reader is default-deny. Every GRANT/REVOKE token that appears where it would execute — in
// the code of the file, or anywhere inside a DO block or a function body, string literals
// included, because a body's strings are what EXECUTE runs — must end up as an effect the reader
// understood or as an UNPROVEN entry. A token the reader could not account for is UNPROVEN too.
// The real PostgreSQL seam and the production catalog remain the oracles; this reader only stops
// the text gate from approving a provably wrong decision, or from staying silent about one it
// cannot read.

/** The grantee spellings a GRANT/REVOKE names, mapped onto the registry's four. */
const GRANTEE_WORDS: Record<string, Grantee> = {
  public: "public", anon: "anon", authenticated: "authenticated", service_role: "serviceRole",
};

export type PrivilegeAction = "GRANT" | "REVOKE";

export interface PrivilegeEffect {
  /** function name; overloads share it */
  fn: string;
  /** the exact identity signature when the statement wrote one; null for a `%s` placeholder, which
   *  the DO loop resolves by NAME and therefore hits every overload */
  sig: string | null;
  role: Grantee;
  action: PrivilegeAction;
  /** position in the file, so "final" is well defined */
  at: number;
  via: "direct" | "do-block";
}

export interface PrivilegeReading {
  effects: PrivilegeEffect[];
  /** privilege SQL the reader could not reduce to (function, role, action) triples */
  unproven: string[];
}

const roleWords = (list: string): { roles: Grantee[]; dynamic: boolean } => {
  const roles: Grantee[] = [];
  let dynamic = false;
  for (const raw of list.split(",")) {
    let word = raw.trim().toLowerCase();
    word = word.replace(/^group\s+/, "").replace(/^"|"$/g, "");
    if (!word) continue;
    if (/%/.test(word)) dynamic = true;
    const g = GRANTEE_WORDS[word];
    if (g) roles.push(g);
  }
  return { roles, dynamic };
};

const TRAILING_CLAUSE = /\s+(with\s+grant\s+option|cascade|restrict|granted\s+by\s+(?:"[^"]+"|[a-z_][a-z0-9_]*))\s*$/i;

/** Signature text for an explicit `name(uuid, int)` in a GRANT: PostgreSQL's identity spelling. */
function explicitSignature(name: string, argList: string): string {
  const types = splitTopLevel(argList).map(identityTypeOfArgument).filter((t): t is string => t !== null);
  return `public.${name}(${types.join(", ")})`;
}

/**
 * Parse one GRANT/REVOKE statement. Returns true when the statement was accounted for (as effects,
 * as an unproven entry, or as a grant on something other than a function); false when it is not a
 * GRANT/REVOKE at all. `placeholderNames` are the functions a `%s`/`%I` target stands for, or
 * null outside a DO block.
 */
function readDirect(
  statement: string, at: number, via: PrivilegeEffect["via"], placeholderNames: readonly string[] | null,
  reading: PrivilegeReading,
): boolean {
  const s = statement.replace(/\s+/g, " ").trim();
  const short = s.slice(0, 120);
  const verb = /^(grant|revoke)\b/i.exec(s);
  if (!verb) return false;
  const code = codeOnly(s);
  if (!/\bon\b/i.test(code)) { reading.unproven.push(`role membership is not a function privilege this gate reads: ${short}`); return true; }
  if (/\bon\s+all\s+(functions|procedures|routines)\b/i.test(code)) {
    reading.unproven.push(`a wildcard over every function is decided by the catalog at run time, not by this file: ${short}`); return true;
  }
  const onFn = /\bon\s+(function|procedure|routine)\s+/i.exec(code);
  if (!onFn) return true;                                       // a table, schema, sequence, type… grant: not ours
  if (/^(grant|revoke)\s+grant\s+option\s+for\b/i.test(s)) {
    reading.unproven.push(`GRANT OPTION FOR is not a privilege decision this gate reads: ${short}`); return true;
  }
  const action: PrivilegeAction = verb[1].toLowerCase() === "grant" ? "GRANT" : "REVOKE";

  // The function list: `[schema.]name(args)` items, or a `%s`/`%I` placeholder, comma separated.
  // `code` has quoted identifiers blanked to spaces, so step past the keyword on `code` and past
  // the whitespace on `s` — otherwise a quoted "public"."fn" is skipped as if it were blank.
  let pos = onFn.index + onFn[0].trimEnd().length;
  while (s[pos] === " ") pos += 1;
  const targets: { fn: string; sig: string | null }[] = [];
  for (;;) {
    const ph = /^%[sI]\b(?:\s*\(([^)]*)\))?\s*/.exec(s.slice(pos));
    if (ph) {
      if (!placeholderNames) { reading.unproven.push(`function built at run time: ${short}`); return true; }
      if (placeholderNames.length === 0) { reading.unproven.push(`function built at run time and no name literal identifies it: ${short}`); return true; }
      for (const fn of placeholderNames) targets.push({ fn, sig: null });
      pos += ph[0].length;
    } else {
      const item = new RegExp(String.raw`^(?:${IDENT}\s*\.\s*)?${IDENT}\s*`, "i").exec(s.slice(pos));
      if (!item) { reading.unproven.push(`cannot read the function in: ${short}`); return true; }
      const schema = item[1] !== undefined || item[2] !== undefined ? identifierText(item[1], item[2]) : "public";
      const name = identifierText(item[3], item[4]);
      pos += item[0].length;
      if (s[pos] !== "(") { reading.unproven.push(`a function grant needs an argument list to name ONE overload: ${short}`); return true; }
      const close = matchingParen(s, pos);
      if (close === -1) { reading.unproven.push(`unbalanced argument list: ${short}`); return true; }
      const args = s.slice(pos + 1, close - 1);
      if (/%/.test(args)) { reading.unproven.push(`function built at run time: ${short}`); return true; }
      if (schema === "public") targets.push({ fn: name, sig: explicitSignature(name, args) });
      pos = close;
      while (s[pos] === " ") pos += 1;
    }
    if (s[pos] === ",") { pos += 1; while (s[pos] === " ") pos += 1; continue; }
    break;
  }
  const dir = /^(to|from)\s+/i.exec(s.slice(pos));
  if (!dir) { reading.unproven.push(`cannot read the grantee list: ${short}`); return true; }
  let roleList = s.slice(pos + dir[0].length);
  for (;;) { const t = TRAILING_CLAUSE.exec(roleList); if (!t) break; roleList = roleList.slice(0, t.index); }
  const { roles, dynamic } = roleWords(roleList);
  if (dynamic) { reading.unproven.push(`role built at run time: ${short}`); return true; }
  if (roles.length === 0) { reading.unproven.push(`no recognised role in the grantee list: ${short}`); return true; }
  for (const t of targets) for (const role of roles) reading.effects.push({ fn: t.fn, sig: t.sig, role, action, at, via });
  return true;
}

/**
 * The functions a DO block's `%s` placeholder provably stands for: the two shapes this repository
 * uses, and nothing looser.
 *
 *   FOREACH fn IN ARRAY ARRAY['a', 'b'] … WHERE p.proname = fn      (rpc_anon_revoke.sql)
 *   … WHERE p.proname = 'a'                                        (confirm_bank_payment_regrant.sql)
 *
 * plus `proname IN ('a', 'b')` and `proname = ANY (ARRAY['a', 'b'])`. Any other predicate on the
 * function name — `<>`, NOT IN, LIKE, a concatenation, a variable that no literal array binds —
 * is unproven, because a name literal elsewhere in the block (a RAISE NOTICE, a to_regclass)
 * says nothing about what the loop touches.
 */
function placeholderTargets(body: string, knownNames: ReadonlySet<string>): { names: string[]; unproven: string | null } {
  const names = new Set<string>();
  const literals = (list: string): string[] | null => {
    const items = list.split(",").map((x) => x.trim());
    if (!items.every((x) => /^'[a-z0-9_]+'$/i.test(x))) return null;
    return items.map((x) => x.slice(1, -1).toLowerCase());
  };
  let arraysSeen = 0;
  for (const m of body.matchAll(/\barray\s*\[([^\]]*)\]/gi)) {
    const lits = literals(m[1]);
    if (!lits) continue;
    arraysSeen += 1;
    for (const l of lits) if (knownNames.has(l)) names.add(l);
  }
  for (const m of body.matchAll(/\bproname\s*=\s*'([a-z0-9_]+)'/gi)) if (knownNames.has(m[1].toLowerCase())) names.add(m[1].toLowerCase());
  for (const m of body.matchAll(/\bproname\s+in\s*\(([^)]*)\)/gi)) for (const l of literals(m[1]) ?? []) if (knownNames.has(l)) names.add(l);
  // Every predicate on proname must be one of the accepted forms.
  for (const m of body.matchAll(/\bproname\b\s*([^\n]{0,80})/gi)) {
    const rest = m[1];
    if (!/^(=|<>|!=|<|>|~|\b(?:in|not|like|ilike|is)\b)/i.test(rest)) continue;   // not a predicate (e.g. format(…, p.proname, …))
    if (/^=\s*'[a-z0-9_]+'\s*(?:\)|;|$|\b(?:and|or|loop|then)\b)/i.test(rest)) continue;
    if (/^=\s*any\s*\(\s*array\s*\[/i.test(rest)) continue;
    if (/^in\s*\(/i.test(rest)) continue;
    if (arraysSeen > 0 && /^=\s*[a-z_][a-z0-9_]*\s*(?:\)|;|$|\b(?:and|or|loop|then)\b)/i.test(rest)) continue;
    return { names: [...names], unproven: `the function target is not a literal name list: proname ${rest.trim().slice(0, 60)}` };
  }
  return { names: [...names], unproven: null };
}

/** Leading control flow in a plpgsql statement, so `IF … THEN GRANT …` is read as the GRANT it is. */
const CONTROL_PREFIX = /^(?:begin|else|loop|exception|end(?:\s+(?:if|loop|case))?|<<[a-z_][a-z0-9_]*>>|(?:if|elsif|when)\b[\s\S]*?\bthen|(?:for|foreach|while)\b[\s\S]*?\bloop)\s+/i;

function withoutControlPrefix(statement: string): string {
  let s = statement.trim();
  for (;;) {
    const m = CONTROL_PREFIX.exec(s);
    if (!m) return s;
    s = s.slice(m[0].length);
  }
}

/**
 * GRANT/REVOKE and CREATE FUNCTION/PROCEDURE tokens that appear where they would execute. In code
 * at this level; and, inside a body (a dollar-quoted block, or a single-quoted body after DO or
 * AS), in code AND in string literals, because a body's strings are what EXECUTE runs. A string at
 * the top level that is not a body — COMMENT ON … IS '…' — does not count.
 */
function executableTokens(text: string, insideBody: boolean): { privilege: number; create: number } {
  // `WITH GRANT OPTION` and `GRANT OPTION FOR` are clauses of a statement already counted by its verb.
  const count = (slice: string) => ({
    privilege: (slice.match(/(?<!\bwith\s+)\b(grant|revoke)\b(?!\s+option\b)/gi) ?? []).length,
    create: (slice.match(CREATE_RE) ?? []).length,
  });
  const total = { privilege: 0, create: 0 };
  const add = (c: { privilege: number; create: number }) => { total.privilege += c.privilege; total.create += c.create; };
  const regions = lexRegions(text);
  regions.forEach((r, idx) => {
    if (r.kind === "code") { add(count(text.slice(r.start, r.end))); return; }
    if (r.kind === "dollar") { add(executableTokens(stripSql(dollarInner(text, r)), true)); return; }
    if (r.kind === "string") {
      const before = idx > 0 && regions[idx - 1].kind === "code" ? text.slice(regions[idx - 1].start, regions[idx - 1].end) : "";
      const isBody = insideBody || /\b(do|as)\s*$/i.test(before);
      if (isBody) add(executableTokens(stripSql(stringInner(text, r)), true));
    }
  });
  return total;
}

/**
 * Every function-privilege effect in a piece of SQL, in file order, plus everything the reader
 * could not prove. `knownNames` are the function names a DO block's `%s` may stand for.
 *
 * Accounting: for every top-level statement, the GRANT/REVOKE tokens that would execute are
 * counted, and so are the effects and unproven entries the reader produced for it. A token left
 * over is a decision the reader did not understand, and it is reported as unproven rather than
 * passed over in silence. A CREATE FUNCTION token inside a body is dynamic SQL and unproven too.
 */
export function readPrivilegeStatements(sql: string, knownNames: ReadonlySet<string>): PrivilegeReading {
  const text = stripSql(sql);
  const reading: PrivilegeReading = { effects: [], unproven: [] };
  let statementsRead = 0;
  const read = (statement: string, at: number, via: PrivilegeEffect["via"], names: readonly string[] | null) => {
    if (readDirect(statement, at, via, names, reading)) statementsRead += 1;
  };
  // The inside of a DO block, or of a single-quoted DO body.
  const readBody = (body: string, bodyAt: number) => {
    const stripped = stripSql(body);
    const target = placeholderTargets(stripped, knownNames);
    if (target.unproven) reading.unproven.push(target.unproven);
    // plain statements written inside the block, after any control flow in front of them
    for (const inner of splitStatements(stripped)) {
      const bare = withoutControlPrefix(inner.sql);
      if (/^(grant|revoke)\b/i.test(bare)) read(bare, bodyAt + inner.at, "do-block", null);
    }
    // statements built with format(): the template is read as if it were the statement
    for (const m of stripped.matchAll(/format\(\s*'((?:grant|revoke)\b(?:[^']|'')*)'/gi)) {
      read(m[1].replace(/''/g, "'"), bodyAt + m.index!, "do-block", target.names);
    }
  };
  for (const st of splitStatements(text)) {
    const unprovenAtStart = reading.unproven.length;
    const readAtStart = statementsRead;
    const tokens = executableTokens(st.sql, false);
    const codeCreates = (codeOnly(st.sql).match(CREATE_RE) ?? []).length;
    const summary = st.sql.slice(0, 100).replace(/\s+/g, " ");

    const doDollar = /^do\s+(?:language\s+\w+\s+)?(\$[A-Za-z0-9_]*\$)([\s\S]*)\1/i.exec(st.sql);
    const doString = /^do\s+(?:language\s+\w+\s+)?'/i.test(st.sql);
    if (doDollar) {
      readBody(doDollar[2], st.at + st.sql.indexOf(doDollar[2]));
    } else if (doString) {
      const r = lexRegions(st.sql).find((x) => x.kind === "string");
      if (r) readBody(stringInner(st.sql, r), st.at + r.start + 1);
    } else {
      read(st.sql, st.at, "direct", null);
    }
    // A CREATE FUNCTION in the code of the file is read by readCreates; one inside a body is
    // dynamic SQL that nothing here can read.
    if (tokens.create > codeCreates) reading.unproven.push(`a function is created by dynamic SQL inside a body: ${summary}`);
    const consumed = (reading.unproven.length - unprovenAtStart) + (statementsRead - readAtStart);
    // ALTER DEFAULT PRIVILEGES carries a GRANT/REVOKE verb of its own; unmodelledPrivilegeDdl reports it.
    const reportedElsewhere = /^alter\s+default\s+privileges\b/i.test(st.sql) ? 1 : 0;
    if (tokens.privilege > consumed + reportedElsewhere) {
      reading.unproven.push(`${tokens.privilege - consumed} GRANT/REVOKE token(s) the reader could not account for in: ${summary}`);
    }
  }
  reading.effects.sort((a, b) => a.at - b.at);
  return reading;
}

/** Everything else that shapes who can execute a function, which this gate does not model. */
export function unmodelledPrivilegeDdl(sql: string): string[] {
  const code = codeOnly(stripSql(sql));
  const out: string[] = [];
  for (const m of code.matchAll(/\balter\s+default\s+privileges\b[^;]*/gi)) out.push(`ALTER DEFAULT PRIVILEGES is not modelled by the text gate: ${m[0].slice(0, 100).replace(/\s+/g, " ")}`);
  for (const m of code.matchAll(/\balter\s+(function|procedure|routine)\b[^;]*/gi)) {
    if (/\b(owner\s+to|security\s+definer|security\s+invoker)\b/i.test(m[0])) out.push(`this changes who a function runs as, which the text gate does not model: ${m[0].slice(0, 100).replace(/\s+/g, " ")}`);
  }
  if (/\b(rollback|savepoint)\b/i.test(code) && /\b(grant|revoke)\b/i.test(code)) {
    out.push("a ROLLBACK or SAVEPOINT next to privilege SQL: the final state cannot be read from the text");
  }
  return out;
}

/** The final explicit decision per role for ONE function identity: last statement wins. */
export function decisionsFor(reading: PrivilegeReading, name: string, signature: string | null): Map<Grantee, PrivilegeAction> {
  const out = new Map<Grantee, PrivilegeAction>();
  for (const e of reading.effects) {
    if (e.fn !== name) continue;
    if (e.sig !== null && signature !== null && e.sig !== signature) continue;
    out.set(e.role, e.action);
  }
  return out;
}

/** The final explicit decision per (function name, role), overloads merged. Kept for the index. */
export function finalDecisions(reading: PrivilegeReading): Map<string, Map<Grantee, PrivilegeAction>> {
  const out = new Map<string, Map<Grantee, PrivilegeAction>>();
  for (const e of reading.effects) {
    const per = out.get(e.fn) ?? new Map<Grantee, PrivilegeAction>();
    per.set(e.role, e.action);
    out.set(e.fn, per);
  }
  return out;
}

/**
 * Which of the four default grant paths a piece of SQL explicitly decides for a function, in
 * either direction. Used to derive which repo files shape a function's ACL.
 */
export function grantPathsHandled(sql: string, functionName: string): Set<Grantee> {
  const fn = functionName.toLowerCase();
  const reading = readPrivilegeStatements(sql, new Set([fn]));
  return new Set(reading.effects.filter((e) => e.fn === fn).map((e) => e.role));
}

export const ALL_GRANTEES: readonly Grantee[] = GRANTEES;

export type FindingProblem =
  | "no_registry_entry"                  // a created function has no registry row (always enforced)
  | "default_paths_not_handled"          // a NEW identity leaves one of the four paths undecided
  | "contradicts_intent"                 // a final explicit GRANT/REVOKE contradicts a decided intent
  | "historical_contradiction"           // the same, in a grandfathered file: pinned, not enforced
  | "unknown_intent_touched"             // an explicit decision on an UNKNOWN intent: reported, never failed
  | "unproven_privilege_sql"             // privilege SQL the reader cannot prove (always enforced)
  | "privilege_on_unregistered_function"; // GRANT/REVOKE on a function with no registry row

export interface MigrationFinding {
  file: string;
  problem: FindingProblem;
  signature?: string;
  fn?: string;
  role?: Grantee;
  missing?: Grantee[];
  detail?: string;
}

/** `live` in the registry means the identity exists in production; anything else is new here. */
export function isExistingIdentity(entry: FunctionEntry | undefined): boolean {
  return entry?.status === "live";
}

/**
 * The repo gate over one migration's text.
 *
 *   · Every function it creates or replaces must have a registry row — unless the same file drops
 *     it again afterwards (a transient helper).
 *   · A NEW identity must, outside the grandfather list, carry a final explicit decision for all
 *     four default grant paths — until the deny-by-default boundary in the database is live, a new
 *     function arrives open to three roles and PUBLIC. New means: the registry row is not `live`,
 *     or this same file DROPs the function before creating it again (the DROP resets the ACL and
 *     the default grants come back).
 *   · A body-only CREATE OR REPLACE of an EXISTING identity needs no privilege SQL at all. The
 *     ACL survives the replacement; forcing a rewrite would be the wrong invariant.
 *   · Any GRANT/REVOKE the file does contain is validated by direction, per identity: a final
 *     GRANT where the registry says DENY, or a final REVOKE where it says ALLOW, is a finding.
 *     UNKNOWN is reported, never decided here. On a grandfathered file the contradiction is
 *     historical (later files supersede it) and is pinned by the test rather than enforced.
 *   · Privilege SQL the reader cannot prove, and privilege-shaping DDL it does not model, is a
 *     finding everywhere.
 */
export function checkMigration(
  file: string, sql: string, registry: readonly FunctionEntry[], opts: { grandfathered: boolean },
): MigrationFinding[] {
  const bySignature = new Map(registry.map((e) => [e.signature, e] as const));
  const byName = new Map<string, FunctionEntry[]>();
  for (const e of registry) {
    const n = nameOf(e.signature);
    byName.set(n, [...(byName.get(n) ?? []), e]);
  }
  const findings: MigrationFinding[] = [];
  const { created, unreadable } = readCreates(sql);
  const drops = dropsIn(sql);
  const knownNames = new Set([...byName.keys(), ...created.map((c) => c.name)]);
  const reading = readPrivilegeStatements(sql, knownNames);

  for (const u of unreadable) findings.push({ file, problem: "unproven_privilege_sql", detail: u });
  for (const u of reading.unproven) findings.push({ file, problem: "unproven_privilege_sql", detail: u });
  for (const u of unmodelledPrivilegeDdl(sql)) findings.push({ file, problem: "unproven_privilege_sql", detail: u });

  const transient = new Set<string>();
  for (const f of created) {
    const entry = bySignature.get(f.signature);
    if (!entry && drops.some((d) => d.name === f.name && d.at > f.at)) { transient.add(f.name); continue; }
    if (!entry) { findings.push({ file, signature: f.signature, problem: "no_registry_entry" }); continue; }
    if (opts.grandfathered) continue;
    const droppedFirst = drops.some((d) => d.name === f.name && d.at < f.at);
    if (isExistingIdentity(entry) && !droppedFirst) continue;
    const decided = decisionsFor(reading, f.name, f.signature);
    const missing = ALL_GRANTEES.filter((g) => !decided.has(g));
    if (missing.length) findings.push({ file, signature: f.signature, problem: "default_paths_not_handled", missing });
  }

  const createdHere = new Set(created.map((c) => c.name));
  const createdSignatures = new Set(created.map((c) => c.signature));
  // A GRANT/REVOKE that names an overload the registry does not know is a decision about a function
  // nobody has decided about — the same shape as an unregistered name, one level down.
  const unknownSignatures = new Set<string>();
  for (const e of reading.effects) {
    if (e.sig !== null && !bySignature.has(e.sig) && !createdSignatures.has(e.sig) && !transient.has(e.fn)) unknownSignatures.add(e.sig);
  }
  if (!opts.grandfathered) {
    for (const sig of unknownSignatures) {
      if ((byName.get(nameOf(sig)) ?? []).length > 0) {
        findings.push({ file, fn: nameOf(sig), signature: sig, problem: "privilege_on_unregistered_function", detail: "the name is registered, this overload is not" });
      }
    }
  }
  const touched = new Set(reading.effects.map((e) => e.fn));
  for (const fn of touched) {
    const entries = byName.get(fn) ?? [];
    if (entries.length === 0) {
      // A function created in this very file already carries `no_registry_entry`; saying it twice
      // would only bury the message. A transient helper is dropped again before the file ends.
      if (!opts.grandfathered && !createdHere.has(fn) && !transient.has(fn)) {
        findings.push({ file, fn, problem: "privilege_on_unregistered_function" });
      }
      continue;
    }
    for (const entry of entries) {
      for (const [role, action] of decisionsFor(reading, fn, entry.signature)) {
        const intent = entry.intent[role];
        if (intent === "UNKNOWN") {
          findings.push({ file, fn, role, signature: entry.signature, problem: "unknown_intent_touched", detail: `${action} while intent is UNKNOWN` });
          continue;
        }
        if ((intent === "ALLOW") !== (action === "GRANT")) {
          findings.push({
            file, fn, role, signature: entry.signature,
            problem: opts.grandfathered ? "historical_contradiction" : "contradicts_intent",
            detail: `final explicit ${action} but registry intent is ${intent}`,
          });
        }
      }
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
