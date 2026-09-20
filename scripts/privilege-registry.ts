// scripts/privilege-registry.ts
// [PRIVILEGE-REGISTRY] Who may EXECUTE which function in `public`, written down per full signature.
//
// ── WHY THIS FILE EXISTS ──
//
// Two SECURITY DEFINER functions that write money (reverse_invoice_payment, answer_mollie_refund)
// were callable by `anon` for six days. Their migration DID revoke PUBLIC. It never revoked `anon`,
// because Supabase attaches a NAMED grant to anon, authenticated and service_role on every new
// function (ALTER DEFAULT PRIVILEGES … GRANT EXECUTE ON FUNCTIONS), and `REVOKE … FROM PUBLIC`
// does not touch a named grantee. The migration also lived only in production's migration history,
// never in this repository. Nothing in the repo could have noticed either fact.
//
// This file is the declared intent. It is NOT the oracle: the PostgreSQL catalog is. Three things
// read it and compare it to something real:
//
//   · src/lib/privilege-gates.test.ts — the repo gate. Every migration that creates or replaces a
//     `public` function must have a row here, and a NEW migration must explicitly handle all four
//     default grant paths (PUBLIC, anon, authenticated, service_role). Early warning only.
//   · tests/sql/privilege-check.sql — the SQL seam. After a test's migrations run on a real
//     PostgreSQL that reproduces Supabase's defaults, the effective privileges are compared with
//     the intent below, from the catalog, not from the text.
//   · docs/PRIVILEGE_ORACLE.sql — the production query, generated from this file. It reads the live
//     catalog and reports, per function and per role, whether reality matches intent.
//
// ── THE THREE VALUES ──
//
// ALLOW and DENY are decisions. UNKNOWN is the honest third value: the evidence to decide is not
// there yet. UNKNOWN is never converted into a pass or a fail by any consumer of this file — it is
// reported, counted, and pinned in a test so that changing it is a visible act.
//
// ── WHAT A ROW DOES NOT DO ──
//
// A row here grants nothing and revokes nothing. Making production equal to the intent is a
// separate, owner-approved step, function by function. Where reality is known to differ from the
// intent and the owner has decided to leave it for a later hardening pass, the deviation is
// recorded under `acceptedDeviations` with its reason, so the oracle can tell "known, deferred"
// from "new drift" — and so nobody quietly widens intent to make a red row green.
//
// Signatures use the type-only identity form PostgreSQL itself prints with
//   format('public.%I(%s)', proname, oidvectortypes(proargtypes))
// e.g. `public.next_invoice_seq(uuid, integer, text)` — never `int`, never parameter names.

export type Decision = "ALLOW" | "DENY" | "UNKNOWN";

/** The four ways a role can end up with EXECUTE on a function in this database. */
export type Grantee = "anon" | "authenticated" | "serviceRole" | "public";

export type Kind =
  | "client_rpc"   // called through the session client (runs as `authenticated`)
  | "server_rpc"   // called through the pipeline client only (runs as `service_role`)
  | "rls_helper"   // called inside a policy expression, as whichever role is querying
  | "trigger"      // fired by a trigger; PostgreSQL checks no EXECUTE for that (measured)
  | "internal"     // called by nothing in this repository
  | "invoker_rpc"  // SECURITY INVOKER function called as an RPC; RLS applies to the caller
  | "obsolete";    // no live application or dependency caller found as of verification; kept in
                   // production until an owner-approved DROP, so its intent is DENY for every role

export type Status =
  | "live"               // exists in production today, measured; an EXISTING identity
  | "planned"            // declared for a repo migration not yet applied to production; a NEW identity
  | "not_in_production"; // a repo migration creates it, production does not have it; a NEW identity

// A function is an existing identity only while its row says `live`. A migration that CREATE OR
// REPLACEs a live function is a body replacement and owes no privilege SQL (the ACL survives). A
// migration that creates a `planned` or `not_in_production` function introduces a new identity
// and must decide all four default grant paths explicitly. `planned` becomes `live` once the
// function has been applied and measured in production; until then the production oracle reports
// it as UNREGISTERED, which is the reminder.

export interface Measured {
  /** Effective EXECUTE per role, measured with has_function_privilege on production. */
  anon: boolean;
  authenticated: boolean;
  serviceRole: boolean;
  /** A PUBLIC entry (`=X/owner`) in proacl, or proacl NULL, which means the built-in default. */
  publicEntry: boolean;
  /** md5(proacl::text). Forensic only: it changes when entry ORDER changes, which is not a privilege. */
  aclMd5: string;
}

export interface Provenance {
  /** True when a file in supabase/migrations creates this function. Cross-checked by the gate. */
  inRepo: boolean;
  /** Production migration versions (supabase_migrations.schema_migrations) known to have created it. */
  productionVersions: readonly string[];
  /** Where it came from, in one line, when no repo file creates it. */
  note?: string;
}

export interface FunctionEntry {
  signature: string;
  kind: Kind;
  managedBy: "boekbrug";
  owner: "postgres";
  definer: boolean;
  status: Status;
  intent: Record<Grantee, Decision>;
  /** Roles where reality is known to differ from intent, with the owner's reason to leave it for now. */
  acceptedDeviations?: Partial<Record<Grantee, string>>;
  current: Measured | null;
  evidence: readonly string[];
  callers: readonly string[];
  provenance: Provenance;
  verified: { at: string; source: string } | null;
}

/** One acl text per shape, so a row can point at the shape instead of repeating it. */
const ACL = {
  /** PUBLIC + postgres + anon + authenticated + service_role, in CREATE order. */
  publicAndThree: "791d2b1e22edbb03f97770724fbb588b",
  /** Same set as above, entries in a different order (a re-grant reordered them). */
  publicAndThreeReordered: "e92c9b8bbc8cbf48623f6bc88746bbad",
  /** postgres + authenticated + service_role. */
  authAndService: "d1707186c8e5f1577bde2338d7541aec",
  /** Same set as authAndService, entries in a different order. */
  authAndServiceReordered: "06c8bd810f2d9a52a993cd903c13793a",
  /** postgres + service_role. */
  serviceOnly: "db23e67d6fad77fdfa003856d807d6af",
  /** postgres + anon + authenticated + service_role, no PUBLIC entry. */
  threeNoPublic: "37a7ab878ddb3c8de2877e90e7224b7e",
} as const;

const MEASURED_AT = "2026-09-20";
const MEASURED_FROM = "production catalog (project cedrndplmydqcmbszfmp), pg_proc + has_function_privilege";
const VERIFIED = { at: MEASURED_AT, source: MEASURED_FROM } as const;

const m = (anon: boolean, authenticated: boolean, serviceRole: boolean, publicEntry: boolean, aclMd5: string): Measured =>
  ({ anon, authenticated, serviceRole, publicEntry, aclMd5 });

const CLOSED_TO_ALL_BUT_SERVICE = m(false, false, true, false, ACL.serviceOnly);
const AUTH_AND_SERVICE = m(false, true, true, false, ACL.authAndService);
const OPEN_TO_ALL = m(true, true, true, true, ACL.publicAndThree);

const REPO: Provenance = { inRepo: true, productionVersions: [] };
const DASHBOARD_ERA: Provenance = {
  inRepo: false,
  productionVersions: [],
  note: "created in the Supabase dashboard before migration history began (first tracked version 20260815111455); no repo file creates it",
};

const intent = (anon: Decision, authenticated: Decision, serviceRole: Decision, pub: Decision): Record<Grantee, Decision> =>
  ({ anon, authenticated, serviceRole, public: pub });

const D = "DENY", A = "ALLOW", U = "UNKNOWN";

// [PRIVILEGE-BEWIJS] The first read-only evidence pass (accepted 2026-09-20) resolved seven
// UNKNOWN decisions into DENY without changing a single privilege. Where reality still says
// ALLOW, the row records that as an accepted deviation with this marker, so the oracle prints
// ACCEPTED_DEVIATION and not DRIFT: deciding the intended boundary and hardening production
// towards it are deliberately two separate steps.
const EVIDENCE_PASS_1 = "resolved by the 2026-09-20 evidence pass; production privilege deliberately unchanged in that PR";
const OBSOLETE_LEGACY_GRANT =
  EVIDENCE_PASS_1 + "; obsolete / no live caller found; the grant is legacy default exposure kept until an owner-approved DROP";

// ── client_rpc: called through the session client, so authenticated must be able to execute ────

const clientRpc = (
  signature: string, callers: readonly string[], evidence: readonly string[], current: Measured = AUTH_AND_SERVICE,
): FunctionEntry => ({
  signature, kind: "client_rpc", managedBy: "boekbrug", owner: "postgres", definer: true, status: "live",
  intent: intent(D, A, A, D), current, evidence, callers, provenance: REPO, verified: VERIFIED,
});

// ── server_rpc: pipeline client only ────────────────────────────────────────────────────────────

const serverRpc = (
  signature: string, callers: readonly string[], evidence: readonly string[], provenance: Provenance = REPO,
): FunctionEntry => ({
  signature, kind: "server_rpc", managedBy: "boekbrug", owner: "postgres", definer: true, status: "live",
  intent: intent(D, D, A, D), current: CLOSED_TO_ALL_BUT_SERVICE, evidence, callers, provenance, verified: VERIFIED,
});

// ── trigger: PostgreSQL fires a trigger without checking EXECUTE on its function (measured on a
//    throwaway PostgreSQL 16: an INSERT as `authenticated` fired a trigger whose function it could
//    not execute). So no role NEEDS a grant. Whether to strip the inert service_role grant, and the
//    anon/PUBLIC grants two of them still carry, is a later hardening decision, hence UNKNOWN. ────

const triggerFn = (
  signature: string, definer: boolean, tables: readonly string[], current: Measured, evidence: readonly string[],
  provenance: Provenance = REPO, acceptedDeviations?: Partial<Record<Grantee, string>>,
): FunctionEntry => ({
  signature, kind: "trigger", managedBy: "boekbrug", owner: "postgres", definer, status: "live",
  intent: intent(D, D, U, current.publicEntry ? U : D), current, evidence,
  callers: tables.map((t) => `trigger on ${t}`), provenance, verified: VERIFIED,
  ...(acceptedDeviations ? { acceptedDeviations } : {}),
});

const LATER_HARDENING_TRIGGER =
  "trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)";

export const REGISTRY: readonly FunctionEntry[] = [
  // ── client_rpc (7) ──────────────────────────────────────────────────────────────────────────
  clientRpc("public.allocate_bank_payment(uuid, uuid, uuid, numeric, date)",
    ["src/app/api/bank/allocate/route.ts (session client)", "nested inside apply_bank_payment"],
    ["allocate_bank_payment.sql revokes PUBLIC and grants authenticated", "rpc_anon_revoke.sql revokes anon, grants service_role"]),
  clientRpc("public.apply_bank_payment(uuid, uuid, uuid, numeric, date)",
    ["src/lib/bank-auto-confirm.ts (payClient, session client)"],
    ["invoice_partial_payments.sql revokes PUBLIC, grants authenticated + service_role", "rpc_anon_revoke.sql revokes anon"]),
  clientRpc("public.apply_manual_payment(uuid, uuid, numeric, date, text, text[], uuid)",
    ["src/app/api/invoice/pay-toggle/route.ts and six other .rpc() sites"],
    ["invoice_manual_payments.sql revokes PUBLIC", "rpc_anon_revoke.sql revokes anon, grants service_role"]),
  clientRpc("public.book_bank_batch(uuid, uuid, uuid[], date)",
    ["src/app/api/bank/confirm/route.ts (session client)"],
    ["book_bank_batch_atomic.sql / bank_confirm_atomic.sql revoke PUBLIC", "rpc_anon_revoke.sql revokes anon, grants service_role"]),
  clientRpc("public.confirm_bank_payment(uuid, uuid, uuid, date)",
    ["src/app/api/bank/confirm/route.ts", "src/lib/bank-auto-confirm.ts (payClient)"],
    ["bank_confirm_atomic.sql revokes PUBLIC", "rpc_anon_revoke.sql revokes anon", "confirm_bank_payment_regrant.sql re-grants authenticated"],
    m(false, true, true, false, ACL.authAndServiceReordered)),
  clientRpc("public.move_invoice_payment(uuid, uuid, uuid)",
    ["src/app/api/invoice/payment/move/route.ts (session client)"],
    ["invoice_move_payment.sql revokes PUBLIC", "rpc_anon_revoke.sql revokes anon, grants service_role"]),
  clientRpc("public.next_invoice_seq(uuid, integer, text)",
    ["src/lib/invoice-numbering.ts (injected client: session or pipeline)"],
    ["factuur_b_numbering.sql revokes PUBLIC, grants authenticated", "rpc_anon_revoke.sql revokes anon, grants service_role"]),

  // ── rls_helper (5): called inside policies as the querying role ────────────────────────────
  {
    signature: "public.is_my_accountant_client(uuid)", kind: "rls_helper", managedBy: "boekbrug", owner: "postgres",
    definer: true, status: "live",
    // anon ALLOW is REQUIRED, not tolerated: five policies are `TO public`, and revoking anon from
    // this function broke anonymous reads in production ("permission denied for function"). The
    // [ANON-ORAKEL] gate in lifecycle-gates.test.ts refuses any migration that revokes it.
    intent: intent(A, A, A, U),
    current: m(true, true, true, true, ACL.publicAndThreeReordered),
    evidence: [
      "production incident: revoking anon produced 'permission denied for function' on anonymous reads",
      "policies TO public: invoices_accountant_read, invoices_accountant_update_v2, invoice_lines_select_accountant, documents_accountant_read, acc_status_owner_write",
      "policies TO authenticated: assets_accountant_read, folders_accountant_read",
    ],
    callers: ["7 RLS policies (5 TO public, 2 TO authenticated)"],
    provenance: DASHBOARD_ERA, verified: VERIFIED,
  },
  {
    signature: "public.acting_for_owner()", kind: "rls_helper", managedBy: "boekbrug", owner: "postgres",
    definer: true, status: "live",
    // anon and PUBLIC are DENY (evidence pass accepted 2026-09-20). This is NOT the same case as
    // is_my_accountant_client: every policy that calls acting_for_owner is TO authenticated, so
    // anon never evaluates it and its EXECUTE cannot be a policy dependency. The [ANON-ORAKEL]
    // incident's error came from is_my_accountant_client alone. Reality still carries the default
    // anon grant and the PUBLIC entry; both are recorded below and closed in a later, separate step.
    intent: intent(D, A, A, D),
    current: m(true, true, true, true, ACL.publicAndThreeReordered),
    acceptedDeviations: {
      anon: EVIDENCE_PASS_1 + "; anon EXECUTE is default-grant residue, not a policy dependency; left in place until a separate hardening step",
      public: EVIDENCE_PASS_1 + "; the PUBLIC entry is the CREATE-time default, not a policy dependency; left in place until a separate hardening step",
    },
    evidence: [
      "live catalog: 7 policies call it and all are TO authenticated: clients_member_insert/read/update, invoice_lines_member_read/write_draft, invoices_member_read/update_draft",
      "rls_backup.policies_20260901 (snapshot before the initplan rewrite and before the incident): the same 7 policies, all TO authenticated",
      "no TO public policy, function body, view, trigger or pg_depend row references it",
      "body derives the owner from auth.uid(), which is NULL for anon",
      "throwaway-PostgreSQL proof with RLS on and rows present: with anon and PUBLIC EXECUTE revoked, anon reads of invoices/clients/invoice_lines still return zero rows without error; the 'permission denied for function' shape reproduces only when a TO public policy calls it",
    ],
    callers: ["7 RLS policies TO authenticated", "no .rpc() site in src on any remote branch"],
    provenance: REPO, verified: VERIFIED,
  },
  {
    signature: "public.audit_row_is_about_me(text, uuid, uuid)", kind: "rls_helper", managedBy: "boekbrug", owner: "postgres",
    definer: true, status: "live", intent: intent(D, A, A, D), current: AUTH_AND_SERVICE,
    evidence: ["anon_mandate_oracle_revoke.sql revokes PUBLIC + anon, grants authenticated + service_role"],
    callers: ["policy audit_logs_about_me (TO authenticated)"], provenance: REPO, verified: VERIFIED,
  },
  {
    signature: "public.has_active_confirm_mandate(uuid, uuid)", kind: "rls_helper", managedBy: "boekbrug", owner: "postgres",
    definer: true, status: "live", intent: intent(D, A, A, D), current: AUTH_AND_SERVICE,
    evidence: ["anon_mandate_oracle_revoke.sql revokes PUBLIC + anon, grants authenticated + service_role"],
    callers: ["policies invoices_mandate_confirm_read, invoices_mandate_confirm_write (TO authenticated)", "nested inside prevent_accountant_amount_changes"],
    provenance: REPO, verified: VERIFIED,
  },
  {
    signature: "public.has_active_invoice_mandate(uuid, uuid)", kind: "rls_helper", managedBy: "boekbrug", owner: "postgres",
    definer: true, status: "live", intent: intent(D, A, A, D), current: AUTH_AND_SERVICE,
    evidence: ["anon_mandate_oracle_revoke.sql revokes PUBLIC + anon, grants authenticated + service_role"],
    callers: ["policies invoice_lines_mandate_read, invoices_mandate_draft_issue, invoices_mandate_draft_read (TO authenticated)", "nested inside next_invoice_seq and prevent_accountant_amount_changes"],
    provenance: REPO, verified: VERIFIED,
  },

  // ── server_rpc (15): pipeline client only ──────────────────────────────────────────────────
  serverRpc("public.ai_budget_consume(bigint, bigint)", ["src/lib/ai-spend.ts (pipeline client)"], ["ai_spend_guard.sql"]),
  serverRpc("public.ai_budget_settle(bigint)", ["src/lib/ai-spend.ts (pipeline client)"], ["ai_budget_settle.sql"]),
  serverRpc("public.check_rate_limit(uuid, text, integer, integer)", ["src/lib/rate-limit.ts (pipeline client)"],
    ["no repo file creates it; the service_role-only ACL was measured"], DASHBOARD_ERA),
  serverRpc("public.check_rate_limit_key(text, text, integer, integer)", ["src/lib/rate-limit.ts (pipeline client)"], ["rate_limit_key.sql"]),
  serverRpc("public.fair_use_consume(uuid, text, text, integer, integer)", ["src/lib/fair-use.ts (pipeline client)"],
    ["fair_use_usage.sql revokes PUBLIC", "rpc_anon_revoke.sql revokes anon + authenticated, grants service_role"]),
  serverRpc("public.fair_use_consume_for_document(uuid, uuid, text, integer)", ["src/lib/fair-use.ts (pipeline client)"],
    ["ontvangen_fair_use_per_document.sql revokes PUBLIC, anon, authenticated"]),
  serverRpc("public.fair_use_release(uuid, text, text, integer)", ["src/lib/fair-use.ts (pipeline client)"],
    ["fair_use_usage.sql revokes PUBLIC", "rpc_anon_revoke.sql revokes anon + authenticated, grants service_role"]),
  serverRpc("public.fair_use_release_for_document(uuid, uuid)", ["src/lib/fair-use.ts (pipeline client)"],
    ["ontvangen_fair_use_per_document.sql revokes PUBLIC, anon, authenticated"]),
  serverRpc("public.invoice_number_twins(uuid, uuid)", ["src/lib/invoice-twins.ts (pipeline client)"],
    ["invoice_number_twins.sql revokes PUBLIC, anon, authenticated"]),
  serverRpc("public.recompute_invoice_amount_paid(uuid, uuid)", ["five pipeline .rpc() sites"],
    ["invoice_payment_date_rederive.sql revokes PUBLIC", "rpc_anon_revoke.sql revokes anon + authenticated, grants service_role"]),
  serverRpc("public.seed_invoice_counter(uuid, integer, text, integer)", ["src/lib/invoice-numbering.ts (pipeline client)"],
    ["seed_invoice_counter.sql revokes PUBLIC", "rpc_anon_revoke.sql revokes anon + authenticated, grants service_role"]),
  serverRpc("public.vault_delete_secret(uuid)", ["src/lib/mollie-connection.ts and five other pipeline sites"],
    ["no repo file creates it; service_role-only ACL measured"], DASHBOARD_ERA),
  serverRpc("public.vault_read_secret(uuid)", ["src/lib/email-integration.ts (pipeline client)"],
    ["no repo file creates it; service_role-only ACL measured"], DASHBOARD_ERA),
  serverRpc("public.vault_update_or_create_secret(uuid, text, text)", ["src/lib/snelstart-connection.ts, src/lib/email-integration.ts (pipeline client)"],
    ["no repo file creates it; service_role-only ACL measured"], DASHBOARD_ERA),
  serverRpc("public.work_done_counts(uuid, date, date)", ["src/modules/accountant (pipeline client)"],
    ["work_done_counts.sql revokes PUBLIC, anon, authenticated"]),

  // ── internal (1) ───────────────────────────────────────────────────────────────────────────
  {
    signature: "public.cleanup_old_rate_limits()", kind: "internal", managedBy: "boekbrug", owner: "postgres",
    definer: true, status: "live", intent: intent(D, D, A, D), current: CLOSED_TO_ALL_BUT_SERVICE,
    evidence: ["repo grants service_role explicitly", "no .rpc() caller in src; no cron schema in production; scheduler UNKNOWN"],
    callers: ["none found in this repository"], provenance: DASHBOARD_ERA, verified: VERIFIED,
  },

  // ── trigger, SECURITY DEFINER (6) ──────────────────────────────────────────────────────────
  triggerFn("public.assert_credit_within_original()", true, ["invoices"], CLOSED_TO_ALL_BUT_SERVICE,
    ["rpc_anon_revoke.sql revokes PUBLIC, anon, authenticated; grants service_role"]),
  triggerFn("public.assert_credit_within_rate()", true, ["invoice_lines"], CLOSED_TO_ALL_BUT_SERVICE,
    ["revoke_execute_on_trigger_functions.sql"]),
  triggerFn("public.handle_new_user()", true, ["auth.users"], CLOSED_TO_ALL_BUT_SERVICE,
    ["rpc_anon_revoke.sql revokes PUBLIC, anon, authenticated; grants service_role"]),
  triggerFn("public.prevent_verwerkt_invoice_changes()", true, ["invoices"], CLOSED_TO_ALL_BUT_SERVICE,
    ["revoke_execute_on_trigger_functions.sql"]),
  triggerFn("public.accountant_status_door_only()", true, ["invoices"], OPEN_TO_ALL,
    ["created under the default grants; no migration revokes anything on it"], REPO,
    { anon: LATER_HARDENING_TRIGGER, authenticated: LATER_HARDENING_TRIGGER }),
  triggerFn("public.grant_welcome_plus()", true, ["profiles (retired path, see welcome_grant_retired.sql)"], OPEN_TO_ALL,
    ["created under the default grants; no migration revokes anything on it"], REPO,
    { anon: LATER_HARDENING_TRIGGER, authenticated: LATER_HARDENING_TRIGGER }),

  // ── the refund pair, SECURITY DEFINER financial writers (2) ────────────────────────────────
  {
    signature: "public.reverse_invoice_payment(uuid, uuid)", kind: "server_rpc", managedBy: "boekbrug", owner: "postgres",
    definer: true, status: "live",
    // authenticated ALLOW for now: the original migration granted authenticated + service_role
    // explicitly. Removing it is a later deprecation decision, not a correction.
    intent: intent(D, A, A, D), current: AUTH_AND_SERVICE,
    evidence: [
      "production migration 20260913202234 invoice_reverse_payment: REVOKE FROM PUBLIC; GRANT TO authenticated, service_role",
      "anon closed by anon_revoke_refund_writers.sql (PR #367)",
    ],
    callers: ["nested inside answer_mollie_refund only (runs as postgres there); no direct .rpc() site"],
    provenance: { inRepo: false, productionVersions: ["20260913202234"], note: "applied through the MCP apply_migration path; no repo file" },
    verified: VERIFIED,
  },
  {
    signature: "public.answer_mollie_refund(uuid, text, text, numeric)", kind: "server_rpc", managedBy: "boekbrug", owner: "postgres",
    definer: true, status: "live",
    // authenticated DENY (evidence pass accepted 2026-09-20): the creation migration granted
    // service_role only; the authenticated EXECUTE reality still carries is the creation-time
    // named default grant, not a documented intent, and a SECURITY DEFINER body that mutates
    // refund and payment state should not keep an unused direct boundary. Not revoked here.
    intent: intent(D, D, A, D), current: AUTH_AND_SERVICE,
    acceptedDeviations: {
      authenticated: EVIDENCE_PASS_1 + "; authenticated EXECUTE is the creation-time named default grant that REVOKE FROM PUBLIC never touched; no caller uses it; left in place until a separate hardening step",
    },
    evidence: [
      "production migration 20260913221343 mollie_refund_answer (statements read back from supabase_migrations): REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO service_role — and nothing else",
      "anon closed by anon_revoke_refund_writers.sql (PR #367)",
      "no live application caller found as of 2026-09-20: none on main (which Vercel deploys to production), no /rest/v1/rpc/answer_mollie_refund request in the 24h edge logs, no execution row in pg_stat_statements since its 2026-06-03 reset (supporting only: the statement store has evicted)",
      "the only known application caller, the refund route on PR #344 (unmerged), calls through createPipelineClient(), i.e. service_role",
      "body guard: a signed-in caller may only answer refunds where auth.uid() = p_user_id; service_role (auth.uid() NULL) may answer for any owner",
    ],
    callers: ["no .rpc() site in src on main", "PR #344 (unmerged): src/app/api/mollie/terugbetaling/route.ts via the pipeline client (service_role)"],
    provenance: { inRepo: false, productionVersions: ["20260913221343"], note: "applied through the MCP apply_migration path; no repo file" },
    verified: VERIFIED,
  },

  // ── invoker functions in public, owner postgres (16) ───────────────────────────────────────
  ...(["clients", "documents", "folders", "invoices"] as const).map((t): FunctionEntry => ({
    signature: `public.search_${t}_fuzzy(text)`, kind: "invoker_rpc", managedBy: "boekbrug", owner: "postgres",
    definer: false, status: "live",
    // anon DENY is the intent: search_smart.sql describes them as for logged-in users and grants
    // authenticated. The PUBLIC entry they carry is the built-in default nobody revoked; closing
    // it is later hardening. service_role ALLOW is current compatibility.
    intent: intent(D, A, A, U), current: OPEN_TO_ALL,
    acceptedDeviations: { anon: "PUBLIC default entry never revoked; later hardening, not this PR" },
    evidence: ["search_smart.sql: GRANT EXECUTE … TO authenticated; described as for logged-in users", "SECURITY INVOKER: RLS applies to the caller"],
    callers: ["src/lib/bestanden.ts (session client)", "src/app/api/search/route.ts (session client)"],
    provenance: REPO, verified: VERIFIED,
  })),
  {
    signature: "public.mollie_refund_reason_of(text)", kind: "internal", managedBy: "boekbrug", owner: "postgres",
    definer: false, status: "live", intent: intent(D, D, A, D),
    current: m(true, true, true, false, ACL.threeNoPublic),
    acceptedDeviations: {
      anon: "original migration intended service_role only; anon/authenticated kept by the default grant; no change in this PR",
      authenticated: "original migration intended service_role only; no change in this PR",
    },
    evidence: ["production migration 20260913221343: REVOKE FROM PUBLIC; GRANT TO service_role", "IMMUTABLE text-to-code mapping, reads nothing"],
    callers: ["nested inside answer_mollie_refund"],
    provenance: { inRepo: false, productionVersions: ["20260913221343"], note: "applied through the MCP apply_migration path; no repo file" },
    verified: VERIFIED,
  },
  {
    signature: "public.get_accountant_for_zzper(uuid)", kind: "obsolete", managedBy: "boekbrug", owner: "postgres",
    definer: false, status: "live",
    // obsolete / no live caller found (evidence pass accepted 2026-09-20). DENY for every role is
    // the intended boundary; the four current ALLOWs are legacy default exposure, recorded below.
    // Absence of a caller is stated narrowly: none FOUND as of this verification, not "can never
    // be used". Confidence in the evidence is medium for authenticated and service_role. The clean
    // resolution is an owner-approved DROP in a later change; nothing is dropped or revoked here.
    intent: intent(D, D, D, D), current: OPEN_TO_ALL,
    acceptedDeviations: {
      anon: OBSOLETE_LEGACY_GRANT,
      authenticated: OBSOLETE_LEGACY_GRANT,
      serviceRole: OBSOLETE_LEGACY_GRANT,
      public: OBSOLETE_LEGACY_GRANT,
    },
    evidence: [
      "no live application or dependency caller found as of 2026-09-20: no .rpc() site in src on main or on any examined remote branch; no policy, view, trigger or pg_depend row references it",
      "appears in the repository only in the May 2026 production snapshot (database.sql, section 'Accountant Lookup') and in generated database types; never created by a repo migration (function_search_path.sql only pins its search_path)",
      "SECURITY INVOKER over accountant_clients, which has RLS enabled and only TO authenticated policies: anon gets NULL, authenticated sees only rows it could read directly, service_role bypasses RLS",
      "throwaway-PostgreSQL proof of the three role outcomes above",
      "current grants are the CREATE-time PUBLIC entry plus the three named default grants, not a documented application contract",
    ],
    callers: ["none found in this repository as of 2026-09-20 (main and the examined remote branches)"],
    provenance: DASHBOARD_ERA, verified: VERIFIED,
  },
  triggerFn("public.assert_paid_is_backed()", false, ["invoices"], OPEN_TO_ALL,
    ["invoice_paid_requires_allocation.sql; created under the default grants"], REPO,
    { anon: LATER_HARDENING_TRIGGER, authenticated: LATER_HARDENING_TRIGGER }),
  triggerFn("public.documents_search_vector_update()", false, ["documents"], OPEN_TO_ALL,
    ["no repo file creates it; created under the default grants"], DASHBOARD_ERA,
    { anon: LATER_HARDENING_TRIGGER, authenticated: LATER_HARDENING_TRIGGER }),
  triggerFn("public.prevent_billing_self_grant()", false, ["profiles"], OPEN_TO_ALL,
    ["billing_subscription.sql; created under the default grants"], REPO,
    { anon: LATER_HARDENING_TRIGGER, authenticated: LATER_HARDENING_TRIGGER }),
  triggerFn("public.prevent_paid_invoice_rewrite()", false, ["invoices"], OPEN_TO_ALL,
    ["paid_invoice_money_frozen.sql; created under the default grants"], REPO,
    { anon: LATER_HARDENING_TRIGGER, authenticated: LATER_HARDENING_TRIGGER }),
  triggerFn("public.set_updated_at()", false, ["bank_connection_accounts", "bank_connections", "suppliers", "work_items"], OPEN_TO_ALL,
    ["bank_connections_updated_at.sql; created under the default grants"], REPO,
    { anon: LATER_HARDENING_TRIGGER, authenticated: LATER_HARDENING_TRIGGER }),
  triggerFn("public.touch_updated_at()", false, ["accountant_subject_status"], OPEN_TO_ALL,
    ["no repo file creates it; created under the default grants"], DASHBOARD_ERA,
    { anon: LATER_HARDENING_TRIGGER, authenticated: LATER_HARDENING_TRIGGER }),
  triggerFn("public.assert_bookkeeping_date_sane()", false, ["bank_tx_invoices", "cash_entries", "daily_turnover", "invoices"],
    CLOSED_TO_ALL_BUT_SERVICE, ["revoke_execute_on_trigger_functions.sql"]),
  triggerFn("public.guard_paid_when_verwerkt()", false, ["invoices"], CLOSED_TO_ALL_BUT_SERVICE,
    ["revoke_execute_on_trigger_functions.sql; no repo file creates it"], DASHBOARD_ERA),
  triggerFn("public.invoices_search_vector_update()", false, ["invoices"], CLOSED_TO_ALL_BUT_SERVICE,
    ["revoke_execute_on_trigger_functions.sql; no repo file creates it"], DASHBOARD_ERA),
  triggerFn("public.prevent_accountant_amount_changes()", false, ["invoices"], CLOSED_TO_ALL_BUT_SERVICE,
    ["revoke_execute_on_trigger_functions.sql"]),

  // ── [VRAAG-SYNC] the one write path for (invoices.accountant_status, the accountant's own
  //    invoice question row); server door only. Planned: the migration is in the repo and not yet
  //    applied to production — `planned` becomes `live` once it is measured there.
  {
    signature: "public.accountant_set_invoice_status(uuid, uuid, uuid, text, text)", kind: "server_rpc", managedBy: "boekbrug", owner: "postgres",
    definer: false, status: "planned", intent: intent(D, D, A, D), current: null,
    evidence: ["accountant_invoice_status_sync.sql revokes PUBLIC, anon, authenticated; grants service_role"],
    callers: ["src/lib/accountant-status-door.ts (pipeline client)"], provenance: REPO, verified: null,
  },

  // ── created by a repo migration, absent from production ────────────────────────────────────
  {
    signature: "public.document_is_referenced(uuid)", kind: "invoker_rpc", managedBy: "boekbrug", owner: "postgres",
    definer: false, status: "not_in_production", intent: intent(U, U, U, U), current: null,
    evidence: ["documents_content_hash_unique.sql creates it; production has no such function (not applied, or applied and dropped outside the repo)"],
    callers: ["none found in src"], provenance: REPO, verified: null,
  },
];

// ── Platform-managed functions in `public` ─────────────────────────────────────────────────────
//
// These are not BoekBrug RPCs and get no per-row intent. The rule is per class: every function
// owned by the platform role in `public` must belong to a named extension, must not be SECURITY
// DEFINER, and keeps the privileges the extension installed. A platform-owned function OUTSIDE
// these classes is a finding, never a pass — the oracle reports it as UNEXPECTED_PLATFORM_FUNCTION.

export interface PlatformClass {
  owner: string;
  extension: string;
  schema: "public";
  /** Function count when this row was written. Reported, not asserted: extension upgrades change it. */
  countAt: { n: number; at: string };
  definerAllowed: false;
}

export const PLATFORM_CLASSES: readonly PlatformClass[] = [
  { owner: "supabase_admin", extension: "pg_trgm", schema: "public", countAt: { n: 31, at: MEASURED_AT }, definerAllowed: false },
];

// ── Expected function-type rows in pg_default_acl ──────────────────────────────────────────────
//
// What production has TODAY (measured 2026-09-20). This is the shape the oracle asserts, so that a
// platform change to the defaults — or a future, owner-approved change of our own — is seen the
// day it happens rather than discovered by the next incident. The ACL is compared as a SET of
// entries; order is not a privilege.

export interface DefaultAclRow {
  forRole: string;
  schema: string;
  entries: readonly string[];
}

const THREE_ROLES_BY = (grantor: string) => [
  `postgres=X/${grantor}`, `anon=X/${grantor}`, `authenticated=X/${grantor}`, `service_role=X/${grantor}`,
];

export const EXPECTED_FUNCTION_DEFAULT_ACL: readonly DefaultAclRow[] = [
  { forRole: "postgres", schema: "public", entries: THREE_ROLES_BY("postgres") },
  { forRole: "postgres", schema: "storage", entries: THREE_ROLES_BY("postgres") },
  { forRole: "supabase_admin", schema: "extensions", entries: ["postgres=X*/supabase_admin"] },
  { forRole: "supabase_admin", schema: "graphql", entries: THREE_ROLES_BY("supabase_admin") },
  { forRole: "supabase_admin", schema: "graphql_public", entries: THREE_ROLES_BY("supabase_admin") },
  { forRole: "supabase_admin", schema: "public", entries: THREE_ROLES_BY("supabase_admin") },
  { forRole: "supabase_admin", schema: "realtime", entries: ["postgres=X/supabase_admin", "dashboard_user=X/supabase_admin"] },
  { forRole: "supabase_auth_admin", schema: "auth", entries: ["postgres=X/supabase_auth_admin", "dashboard_user=X/supabase_auth_admin"] },
];

// ── Production migrations applied outside the versioned path ───────────────────────────────────
//
// supabase_migrations.schema_migrations records what the MCP apply_migration path and the CLI
// applied, with the full statement text. A row there whose name matches no file in
// supabase/migrations/ is a migration nobody can review in git. The provenance query in
// docs/PRIVILEGE_ORACLE.sql lists every such row that carries function or privilege DDL and
// reports it as DRIFT — unless it is acknowledged here, with the repo file it corresponds to (when
// one exists) and the reason. An acknowledgement is a decision, so it is written down, not inferred.

export interface AcknowledgedMigration {
  version: string;
  name: string;
  /** The repo file whose content this production row carries, or null when none exists. */
  repoFile: string | null;
  /** Functions the production statements create or replace, so the oracle can check the mapping. */
  functions: readonly string[];
  reason: string;
}

export const ACKNOWLEDGED_PRODUCTION_MIGRATIONS: readonly AcknowledgedMigration[] = [
  { version: "20260820203635", name: "profile_vak", repoFile: "profile_vak.sql", functions: ["handle_new_user"],
    reason: "same-named repo file; recorded here because the production row also rewrites handle_new_user" },
  { version: "20260831194434", name: "accountant_discount_guard", repoFile: "accountant_discount_guard.sql", functions: ["prevent_accountant_amount_changes"],
    reason: "same-named repo file" },
  { version: "20260901232158", name: "rls_baseline_snapshot_before_initplan", repoFile: null, functions: [],
    reason: "snapshot of pg_policies into rls_backup.policies_20260901 before the initplan rewrite, with REVOKEs on that schema and table; creates no function, no repo file" },
  { version: "20260912162856", name: "anon_owner_oracle_revoke", repoFile: null, functions: [],
    reason: "the [ANON-ORAKEL] incident: revoked anon from is_my_accountant_client and acting_for_owner together and broke anonymous reads; the error came from is_my_accountant_client, whose policies are TO public — acting_for_owner's are all TO authenticated and never needed anon; rolled back by the three rows that follow" },
  { version: "20260912162934", name: "anon_owner_oracle_revoke_from_public", repoFile: null, functions: [], reason: "second step of the same incident" },
  { version: "20260912163155", name: "anon_owner_oracle_revoke_rollback", repoFile: null, functions: [], reason: "rollback of the incident: anon re-granted" },
  { version: "20260912163226", name: "anon_owner_oracle_restore_public_grant", repoFile: null, functions: [], reason: "rollback of the incident: PUBLIC re-granted" },
  { version: "20260913001416", name: "bundel_drempel_book_bank_batch_status", repoFile: "bank_rpc_never_payable_states.sql", functions: ["book_bank_batch"],
    reason: "book_bank_batch body from bank_rpc_never_payable_states.sql, applied as its own MCP migration" },
  { version: "20260913202148", name: "mollie_refunds", repoFile: null, functions: [],
    reason: "the mollie_refunds table and its policy; MCP-applied, no repo file (table drift, tracked with the refund functions)" },
  { version: "20260913202207", name: "subscription_price_snapshot", repoFile: "billing_subscription.sql", functions: ["prevent_billing_self_grant"],
    reason: "the [PRIJS-MOMENT] price snapshot; its prevent_billing_self_grant rewrite lives in billing_subscription.sql" },
  { version: "20260913202234", name: "invoice_reverse_payment", repoFile: null, functions: ["reverse_invoice_payment"],
    reason: "MCP-applied, no repo file; registry row carries the recovered intent (authenticated + service_role)" },
  { version: "20260913221343", name: "mollie_refund_answer", repoFile: null, functions: ["answer_mollie_refund", "mollie_refund_reason_of"],
    reason: "MCP-applied, no repo file; registry rows carry the recovered intent (service_role only)" },
  { version: "20260913223813", name: "mandate_requires_accountant_role", repoFile: null, functions: ["has_active_invoice_mandate"],
    reason: "MCP-applied rewrite of has_active_invoice_mandate; body-only (CREATE OR REPLACE keeps the ACL), no repo file" },
  { version: "20260915122913", name: "bank_rpc_never_payable_states_apply", repoFile: "bank_rpc_never_payable_states.sql", functions: ["apply_bank_payment"],
    reason: "one third of bank_rpc_never_payable_states.sql, applied per function" },
  { version: "20260915123016", name: "bank_rpc_never_payable_states_confirm", repoFile: "bank_rpc_never_payable_states.sql", functions: ["confirm_bank_payment"],
    reason: "one third of bank_rpc_never_payable_states.sql, applied per function" },
  { version: "20260915123124", name: "bank_rpc_never_payable_states_allocate", repoFile: "bank_rpc_never_payable_states.sql", functions: ["allocate_bank_payment"],
    reason: "one third of bank_rpc_never_payable_states.sql, applied per function" },
  { version: "20260916061228", name: "handgeschreven_boeking_line_claim_guard", repoFile: "bank_confirm_atomic.sql", functions: ["confirm_bank_payment"],
    reason: "confirm_bank_payment body from the [HANDGESCHREVEN-BOEKING] work, applied as its own MCP migration" },
  { version: "20260916082807", name: "verplaats_teken_move_payment_sign_lock", repoFile: "invoice_move_payment_creditnota_guard.sql", functions: ["move_invoice_payment"],
    reason: "move_invoice_payment body from the sign-lock work, applied as its own MCP migration" },
  { version: "20260916114241", name: "lijn_budget_apply_bank_payment", repoFile: "invoice_partial_payments.sql", functions: ["apply_bank_payment"],
    reason: "apply_bank_payment body from the [LIJN-BUDGET-APPLY] work, applied as its own MCP migration" },
  { version: "20260919104749", name: "ontvangen_fair_use_rpc_revoke_client_roles", repoFile: "ontvangen_fair_use_per_document.sql", functions: [],
    reason: "the REVOKE block at the end of ontvangen_fair_use_per_document.sql, applied as its own MCP migration" },
];

// ── Derived views, for the tests and the generators ────────────────────────────────────────────

export const GRANTEES: readonly Grantee[] = ["anon", "authenticated", "serviceRole", "public"];

export function liveEntries(): FunctionEntry[] {
  return REGISTRY.filter((e) => e.status === "live");
}

export function unknownCount(entries: readonly FunctionEntry[] = REGISTRY): number {
  let n = 0;
  for (const e of entries) for (const g of GRANTEES) if (e.intent[g] === "UNKNOWN") n += 1;
  return n;
}

export function acceptedDeviationCount(entries: readonly FunctionEntry[] = REGISTRY): number {
  let n = 0;
  for (const e of entries) n += Object.keys(e.acceptedDeviations ?? {}).length;
  return n;
}

/** `public.name(args)` → `name`. */
export function nameOf(signature: string): string {
  const m = /^public\.([a-z0-9_]+)\(/.exec(signature);
  if (!m) throw new Error(`not a public function signature: ${signature}`);
  return m[1];
}
