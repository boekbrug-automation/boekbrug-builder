// tests/support/package-fake-db.ts
// [PACKAGE-FAIL-CLOSED] A fake PostgREST + Storage client for the quarter package and the routes
// that deliver it.
//
// The builder in src/lib/closing-package.ts makes some forty reads through one service-role
// client. What this file exists for is failing ONE of them at a time, in each of the three ways a
// real read fails:
//
//   · "error" — the query resolves `{ data: null, error }`, which is what supabase-js does for
//     every HTTP-level failure (a 414, a 500, a timeout). This is the dangerous one: a caller that
//     only destructures `data` sees an empty list and carries on.
//   · "throw" — the await rejects, which is what a dropped connection looks like from inside a
//     helper that throws on `error` (fetchAllRows does).
//   · a failure on a LATER PAGE only (`when: (q) => q.range?.[0] === 1000`) — page one succeeds,
//     so any code that keeps what it had is a truncated read that looks complete.
//
// Deliberately small: filters are applied the way PostgREST would for the operators these reads
// use, and nothing else is modelled. Rows are returned whole whatever the select says, which is
// harmless here — nothing under test reads a column it did not ask for.

export type Row = Record<string, unknown>;

export interface Filter {
  op: string;
  col: string;
  val: unknown;
}

export type WriteKind = "insert" | "update" | "upsert" | "delete";

export interface Query {
  table: string;
  select: string;
  filters: Filter[];
  head: boolean;
  single: boolean;
  write: WriteKind | null;
  payload: unknown;
  range: [number, number] | null;
  limit: number | null;
}

export interface Failure {
  table: string;
  when?: (q: Query) => boolean;
  /** "error" resolves `{ data: null, error }` (the default); "throw" rejects the await. */
  mode?: "error" | "throw";
  message?: string;
}

export interface StorageFailure {
  /** The storage key, or a pattern over it. */
  path: string | RegExp;
  /**
   * "error" resolves `{ data: null, error }` — `error` exactly as given, or built from `status` and
   * `message`; "throw" rejects the download; "empty" resolves `{ data: null, error: null }`, an
   * answer that says nothing at all.
   */
  mode: "error" | "throw" | "empty";
  status?: number | null;
  message?: string;
  /** The error object Storage hands back, verbatim — for shapes the two fields above cannot make. */
  error?: Record<string, unknown>;
}

export interface FakeDbOptions {
  failures?: Failure[];
  /** Storage objects in the `documents` bucket, by key. */
  storage?: Record<string, Uint8Array>;
  storageFailures?: StorageFailure[];
  /** Called for every query as it is awaited — lets a test act at an exact point in a run. */
  onQuery?: (q: Query) => void;
}

const str = (v: unknown) => (v == null ? null : String(v));

/** The literal PostgREST writes inside `.or("a.eq.x,b.is.null")`. */
function literal(v: string): unknown {
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

export function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter((r) =>
    filters.every((f) => {
      const v = r[f.col];
      switch (f.op) {
        case "eq":
          return f.val == null ? v == null : str(v) === str(f.val);
        case "neq":
          // SQL: NULL <> 'x' is NULL, not true — the row is not returned.
          return v != null && str(v) !== str(f.val);
        case "is":
          return f.val === null ? v == null : v === f.val;
        case "not_is":
          return f.val === null ? v != null : v !== f.val;
        case "in":
          return (f.val as unknown[]).map(str).includes(str(v));
        case "gte":
          return v != null && String(v) >= String(f.val);
        case "lte":
          return v != null && String(v) <= String(f.val);
        case "gt":
          return v != null && String(v) > String(f.val);
        case "lt":
          // Numeric when both sides are numbers — `.lt("amount", 0)` is a sign test.
          if (typeof v === "number" && typeof f.val === "number") return v < f.val;
          return v != null && String(v) < String(f.val);
        case "or":
          return String(f.val)
            .split(",")
            .some((clause) => {
              const [col, op, ...rest] = clause.split(".");
              return applyFilters([r], [{ op, col, val: literal(rest.join(".")) }]).length === 1;
            });
        default:
          return true;
      }
    }),
  );
}

let generated = 0;

export function makeFakeDb(tables: Record<string, Row[]>, opts: FakeDbOptions = {}) {
  const seen: Query[] = [];
  const failures = opts.failures ?? [];

  const builder = (table: string) => {
    const q: Query = {
      table, select: "*", filters: [], head: false, single: false, write: null, payload: null, range: null, limit: null,
    };
    const orders: { col: string; asc: boolean }[] = [];
    let returning = false;
    const self: Record<string, unknown> = {};
    const chain = (fn: () => void) => {
      fn();
      return self;
    };
    Object.assign(self, {
      select: (cols = "*", o?: { count?: string; head?: boolean }) =>
        chain(() => {
          if (q.write) returning = true;
          else q.select = cols;
          q.head = !!o?.head;
        }),
      eq: (col: string, val: unknown) => chain(() => q.filters.push({ op: "eq", col, val })),
      neq: (col: string, val: unknown) => chain(() => q.filters.push({ op: "neq", col, val })),
      is: (col: string, val: unknown) => chain(() => q.filters.push({ op: "is", col, val })),
      not: (col: string, op: string, val: unknown) => chain(() => q.filters.push({ op: `not_${op}`, col, val })),
      in: (col: string, val: unknown[]) => chain(() => q.filters.push({ op: "in", col, val })),
      gte: (col: string, val: unknown) => chain(() => q.filters.push({ op: "gte", col, val })),
      lte: (col: string, val: unknown) => chain(() => q.filters.push({ op: "lte", col, val })),
      gt: (col: string, val: unknown) => chain(() => q.filters.push({ op: "gt", col, val })),
      lt: (col: string, val: unknown) => chain(() => q.filters.push({ op: "lt", col, val })),
      or: (expr: string) => chain(() => q.filters.push({ op: "or", col: "", val: expr })),
      order: (col: string, o?: { ascending?: boolean }) => chain(() => orders.push({ col, asc: o?.ascending !== false })),
      range: (from: number, to: number) => chain(() => { q.range = [from, to]; }),
      limit: (n: number) => chain(() => { q.limit = n; }),
      maybeSingle: () => chain(() => { q.single = true; }),
      single: () => chain(() => { q.single = true; }),
      insert: (payload: unknown) => chain(() => { q.write = "insert"; q.payload = payload; }),
      upsert: (payload: unknown) => chain(() => { q.write = "upsert"; q.payload = payload; }),
      update: (payload: unknown) => chain(() => { q.write = "update"; q.payload = payload; }),
      delete: () => chain(() => { q.write = "delete"; }),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        seen.push(q);
        opts.onQuery?.(q);
        const failure = failures.find((f) => f.table === table && (!f.when || f.when(q)));
        if (failure) {
          const message = failure.message ?? "connection reset by peer";
          if (failure.mode === "throw") return Promise.reject(new Error(message)).then(resolve, reject);
          return Promise.resolve({ data: null, error: { message, code: "08006" }, count: null }).then(resolve, reject);
        }
        let result: unknown;
        if (q.write === "insert" || q.write === "upsert") {
          const list = (Array.isArray(q.payload) ? q.payload : [q.payload]) as Row[];
          const stored = list.map((r) => ({ id: `gen-${++generated}`, token: `00000000-0000-4000-8000-${String(generated).padStart(12, "0")}`, ...r }));
          (tables[table] ??= []).push(...stored);
          result = returning ? { data: q.single ? stored[0] ?? null : stored, error: null } : { data: null, error: null };
        } else if (q.write === "update") {
          const hit = applyFilters(tables[table] ?? [], q.filters);
          for (const r of hit) Object.assign(r, q.payload as Row);
          result = returning ? { data: hit, error: null } : { data: null, error: null };
        } else if (q.write === "delete") {
          result = { data: null, error: null };
        } else {
          let rows = applyFilters(tables[table] ?? [], q.filters);
          if (orders.length > 0) {
            rows = [...rows].sort((a, b) => {
              for (const o of orders) {
                const c = (str(a[o.col]) ?? "").localeCompare(str(b[o.col]) ?? "");
                if (c !== 0) return o.asc ? c : -c;
              }
              return 0;
            });
          }
          if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
          if (q.limit != null) rows = rows.slice(0, q.limit);
          result = q.head
            ? { data: null, error: null, count: rows.length }
            : q.single
              ? { data: rows[0] ?? null, error: null }
              : { data: rows, error: null, count: rows.length };
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    });
    return self;
  };

  const downloads: string[] = [];
  const storage = {
    from: () => ({
      download: async (path: string) => {
        downloads.push(path);
        const failure = (opts.storageFailures ?? []).find((f) =>
          typeof f.path === "string" ? f.path === path : f.path.test(path),
        );
        if (failure?.mode === "throw") throw new Error(failure.message ?? "socket hang up");
        if (failure?.mode === "empty") return { data: null, error: null };
        if (failure) {
          return {
            data: null,
            error: failure.error ?? {
              name: "StorageApiError",
              message: failure.message ?? "upstream unavailable",
              status: failure.status === undefined ? 503 : failure.status,
            },
          };
        }
        const bytes = opts.storage?.[path];
        if (!bytes) {
          // What Supabase Storage answers for a key with no object behind it.
          return { data: null, error: { name: "StorageApiError", message: "Object not found", status: 400, statusCode: "404" } };
        }
        return { data: new Blob([new Uint8Array(bytes)]), error: null };
      },
    }),
  };

  const rpcCalls: { name: string; args: unknown }[] = [];
  const client = {
    from: builder,
    storage,
    // The rate limiter is the only RPC on these paths; it is always under its ceiling here.
    rpc: async (name: string, args?: unknown) => {
      rpcCalls.push({ name, args });
      if (name === "check_rate_limit" || name === "check_rate_limit_key") {
        return { data: [{ allowed: true, remaining: 99, reset_at: new Date(Date.now() + 3_600_000).toISOString() }], error: null };
      }
      return { data: null, error: null };
    },
  };

  return {
    client,
    seen,
    downloads,
    rpcCalls,
    /** Every write this client carried, in order. */
    writes: () => seen.filter((q) => q.write !== null),
  };
}
