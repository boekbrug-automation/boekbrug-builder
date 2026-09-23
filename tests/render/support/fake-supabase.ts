// tests/render/support/fake-supabase.ts
// [ARCHIEF-WAAR] An in-memory stand-in for the supabase-js client, just big enough to run the REAL
// syncUserEmails: tables with the unique keys production has, the fair-use and vault RPCs, and a
// storage bucket. Not a PostgREST — a filter it does not understand is recorded in `unknownFilters`
// so a test can assert none were silently ignored.
//
// Faults are injected per call, which is what the sync tests need to prove that a failed read or
// write never becomes a completed attachment: `fault` answers { error } for a matching table/op,
// `storageFault` for an upload.
// The stand-in mirrors an untyped query builder; `any` is the honest type for rows it does not model.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";

type Row = Record<string, any>;
type Filter = (r: Row) => boolean;
export type Op = "select" | "insert" | "upsert" | "update" | "delete";
export interface FaultCall { table: string; op: Op; payload: Row[]; filters: string[] }

/** The unique keys production enforces on the tables the sync writes (verified in pg_indexes). */
export const UNIQUE: Record<string, string[][]> = {
  email_skipped_attachments: [["user_id", "source_message_id"]],
  daily_turnover: [["user_id", "turnover_date"]],
  documents: [["user_id", "content_hash"]],
  invoices: [["receiver_id", "source_message_id"], ["document_id"]],
  email_failed_attempts: [["user_id", "source_message_id"]],
  notifications: [["user_id", "event_key"]],
};

const DEFAULTS: Record<string, Row> = {
  documents: { trashed: false, invoice_id: null },
};

export class FakeDb {
  tables: Record<string, Row[]> = {};
  storage = new Map<string, Buffer>();
  rpcLog: Array<{ fn: string; args: any }> = [];
  unknownFilters: string[] = [];
  /** `${user}|${period}|${metric}` → count, the fair_use counter. */
  usage = new Map<string, number>();
  /** Return true to make this call answer { error }. */
  fault: (c: FaultCall) => boolean = () => false;
  /** Return true to make this storage upload fail. */
  storageFault: (path: string) => boolean = () => false;

  t(name: string): Row[] { return (this.tables[name] ??= []); }

  client() {
    const db = this; // eslint-disable-line @typescript-eslint/no-this-alias -- the closures below outlive `this`
    return {
      from: (table: string) => new Query(db, table),
      rpc: async (fn: string, args: any) => db.rpc(fn, args),
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      storage: {
        from: (bucket: string) => ({
          upload: async (path: string, buf: Buffer) => {
            const k = `${bucket}/${path}`;
            if (db.storageFault(path)) return { data: null, error: { message: "injected storage failure" } };
            if (db.storage.has(k)) return { data: null, error: { message: "exists" } };
            db.storage.set(k, Buffer.from(buf));
            return { data: { path }, error: null };
          },
          remove: async (paths: string[]) => {
            for (const p of paths) db.storage.delete(`${bucket}/${p}`);
            return { data: [], error: null };
          },
          createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://fake/${path}` }, error: null }),
        }),
      },
    };
  }

  async rpc(fn: string, args: any): Promise<{ data: any; error: any }> {
    this.rpcLog.push({ fn, args });
    switch (fn) {
      case "vault_read_secret": return { data: `tok-${String(args.p_secret_id ?? args.secret_id ?? "x")}`, error: null };
      case "vault_create_secret": return { data: randomUUID(), error: null };
      case "vault_update_or_create_secret": return { data: args.p_secret_id ?? randomUUID(), error: null };
      case "fair_use_consume": {
        const k = `${args.p_user_id}|${args.p_period}|${args.p_metric}`;
        const used = this.usage.get(k) ?? 0;
        const limit = Number(args.p_limit ?? 0);
        const amount = Number(args.p_amount ?? 1);
        if (limit > 0 && used + amount > limit) {
          return { data: [{ allowed: false, used, remaining: Math.max(0, limit - used) }], error: null };
        }
        this.usage.set(k, used + amount);
        return { data: [{ allowed: true, used: used + amount, remaining: limit > 0 ? limit - used - amount : -1 }], error: null };
      }
      case "fair_use_release": {
        const k = `${args.p_user_id}|${args.p_period}|${args.p_metric}`;
        this.usage.set(k, Math.max(0, (this.usage.get(k) ?? 0) - Number(args.p_amount ?? 1)));
        return { data: null, error: null };
      }
      case "ai_budget_consume": return { data: [{ allowed: true, spent_micros: 0, budget_micros: 0 }], error: null };
      default: return { data: null, error: null };
    }
  }

  /**
   * Units currently held on one fair-use metric (granted consumes minus releases), summed over
   * every period. Default: the owner's document allowance — the AI spend fuse shares this RPC under
   * an internal metric and is not a reservation anyone is charged for.
   */
  reservedUnits(metric = "aiDocuments"): number {
    let sum = 0;
    for (const [k, n] of this.usage) if (k.endsWith(`|${metric}`)) sum += n;
    return sum;
  }
}

function parseCols(onConflict?: string): string[] {
  return (onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

class Query implements PromiseLike<any> {
  op: Op = "select";
  filters: Filter[] = [];
  filterNames: string[] = [];
  payload: Row[] = [];
  patch: Row = {};
  opts: any = {};
  returning = false;
  mode: "many" | "single" | "maybe" = "many";
  orderBy: Array<[string, boolean]> = [];
  lim?: number; from?: number; to?: number;
  head = false; countWanted = false;
  constructor(private db: FakeDb, private table: string) {}

  private f(name: string, fn: Filter) { this.filters.push(fn); this.filterNames.push(name); return this; }
  select(_cols?: string, o?: { count?: string; head?: boolean }) {
    if (this.op !== "select") this.returning = true;
    if (o?.head) this.head = true;
    if (o?.count) this.countWanted = true;
    return this;
  }
  insert(v: Row | Row[]) { this.op = "insert"; this.payload = Array.isArray(v) ? v : [v]; return this; }
  upsert(v: Row | Row[], o?: any) { this.op = "upsert"; this.payload = Array.isArray(v) ? v : [v]; this.opts = o ?? {}; return this; }
  update(v: Row) { this.op = "update"; this.patch = v; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: any) { return this.f(`eq.${c}`, (r) => r[c] != null && String(r[c]) === String(v)); }
  neq(c: string, v: any) { return this.f(`neq.${c}`, (r) => String(r[c]) !== String(v)); }
  in(c: string, vs: any[]) { const s = new Set(vs.map(String)); return this.f(`in.${c}`, (r) => r[c] != null && s.has(String(r[c]))); }
  is(c: string, v: any) { return this.f(`is.${c}`, (r) => (v === null ? r[c] == null : r[c] === v)); }
  gte(c: string, v: any) { return this.f(`gte.${c}`, (r) => r[c] != null && String(r[c]) >= String(v)); }
  lte(c: string, v: any) { return this.f(`lte.${c}`, (r) => r[c] != null && String(r[c]) <= String(v)); }
  gt(c: string, v: any) { return this.f(`gt.${c}`, (r) => r[c] != null && String(r[c]) > String(v)); }
  lt(c: string, v: any) { return this.f(`lt.${c}`, (r) => r[c] != null && String(r[c]) < String(v)); }
  not(c: string, op: string, v: any) {
    if (op === "is" && v === null) return this.f(`not.is.${c}`, (r) => r[c] != null);
    if (op === "in") {
      const s = new Set(String(v).replace(/[()"]/g, "").split(","));
      return this.f(`not.in.${c}`, (r) => !s.has(String(r[c])));
    }
    this.db.unknownFilters.push(`${this.table}.not.${c}.${op}`);
    return this;
  }
  ilike(c: string, p: string) {
    const re = new RegExp("^" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i");
    return this.f(`ilike.${c}`, (r) => re.test(String(r[c] ?? "")));
  }
  like(c: string, p: string) { return this.ilike(c, p); }
  or(expr: string) {
    const parts = expr.split(",").map((x) => x.match(/^(\w+)\.(eq|is|lt|gt)\.(.+)$/));
    if (parts.some((m) => !m)) { this.db.unknownFilters.push(`${this.table}.or(${expr})`); return this; }
    const tests = parts.map((m) => {
      const [, c, op, v] = m!;
      return (r: Row) => {
        if (op === "is") return v === "null" ? r[c] == null : String(r[c]) === v;
        if (r[c] == null) return false;
        if (op === "lt") return String(r[c]) < v;
        if (op === "gt") return String(r[c]) > v;
        return String(r[c]) === v;
      };
    });
    return this.f(`or`, (r) => tests.some((t) => t(r)));
  }
  filter(c: string, op: string, v: any) { this.db.unknownFilters.push(`${this.table}.filter.${c}.${op}.${v}`); return this; }
  contains(c: string) { this.db.unknownFilters.push(`${this.table}.contains.${c}`); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.orderBy.push([c, o?.ascending !== false]); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(a: number, b: number) { this.from = a; this.to = b; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  abortSignal() { return this; }
  returns() { return this; }

  then<A = any, B = never>(
    ok?: ((v: any) => A | PromiseLike<A>) | null,
    bad?: ((e: any) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, bad);
  }

  private matches(): Row[] { return this.db.t(this.table).filter((r) => this.filters.every((f) => f(r))); }

  private shape(rows: Row[]) {
    if (this.head) return { data: null, error: null, count: rows.length };
    if (this.mode === "single") {
      if (rows.length !== 1) return { data: null, error: { code: "PGRST116", message: `${rows.length} rows` } };
      return { data: rows[0], error: null };
    }
    if (this.mode === "maybe") {
      if (rows.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null, count: this.countWanted ? rows.length : null };
  }

  private conflictOf(row: Row, cols: string[]): Row | undefined {
    return this.db.t(this.table).find((r) => cols.every((c) => r[c] != null && String(r[c]) === String(row[c])));
  }

  private run(): any {
    if (this.db.fault({ table: this.table, op: this.op, payload: this.payload, filters: this.filterNames })) {
      return { data: null, error: { code: "XX000", message: `injected ${this.op} failure on ${this.table}` }, count: null };
    }
    const tbl = this.db.t(this.table);
    if (this.op === "select") {
      let rows = this.matches();
      for (const [c, asc] of [...this.orderBy].reverse()) {
        rows = [...rows].sort((a, b) => (String(a[c] ?? "") < String(b[c] ?? "") ? -1 : String(a[c] ?? "") > String(b[c] ?? "") ? 1 : 0) * (asc ? 1 : -1));
      }
      if (this.from != null) rows = rows.slice(this.from, (this.to ?? rows.length) + 1);
      if (this.lim != null) rows = rows.slice(0, this.lim);
      return this.shape(rows);
    }
    if (this.op === "insert" || this.op === "upsert") {
      const out: Row[] = [];
      const cols = this.op === "upsert" ? parseCols(this.opts.onConflict) : [];
      for (const p of this.payload) {
        const hit = cols.length ? this.conflictOf(p, cols) : undefined;
        if (hit) {
          if (this.opts.ignoreDuplicates) continue;
          Object.assign(hit, p);
          out.push(hit);
          continue;
        }
        for (const uq of UNIQUE[this.table] ?? []) {
          if (uq.every((c) => p[c] != null) && this.conflictOf(p, uq)) {
            return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint on ${this.table}(${uq.join(",")})` } };
          }
        }
        const row = { id: randomUUID(), created_at: new Date().toISOString(), ...(DEFAULTS[this.table] ?? {}), ...p };
        tbl.push(row);
        out.push(row);
      }
      if (!this.returning) return { data: null, error: null };
      return this.shape(out);
    }
    if (this.op === "update") {
      const rows = this.matches();
      for (const r of rows) Object.assign(r, this.patch);
      return this.returning ? this.shape(rows) : { data: null, error: null };
    }
    const rows = this.matches();
    this.db.tables[this.table] = tbl.filter((r) => !rows.includes(r));
    return this.returning ? this.shape(rows) : { data: null, error: null };
  }
}
