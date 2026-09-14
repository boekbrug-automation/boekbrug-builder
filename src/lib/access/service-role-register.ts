// src/lib/access/service-role-register.ts
// [DIENST-SLEUTEL] Every route outside the [RLS-UIT] money line that holds the service-role key,
// and WHY. Pure data, no I/O. Run: npx tsx --test src/lib/access/service-role-register.test.ts
//
// ── WHY CLASSIFY INSTEAD OF REMOVING ────────────────────────────────────────────────────────
//
// createPipelineClient() bypasses row level security completely. Its own header says "DO NOT USE
// FOR: any request triggered directly by a user HTTP call" — and 80 routes outside the money line
// do exactly that. The tempting move is to delete them all. That would break the product in four
// different ways, because the 80 are not one thing:
//
//   · some run when NOBODY is logged in, so there is no session client to use at all;
//   · some touch a table whose RLS has no policy for the command they run — the session is not
//     merely unlucky, it is structurally unable;
//   · some read the OTHER side of a proven pairing (an accountant and their client, an owner and
//     their member), which the policies are not written for;
//   · one writes a column a TRIGGER deliberately forbids the session to touch;
//   · and the rest — the largest group — have no reason on record at all.
//
// Only the last group is a bypass in the sense the specification means. Naming the other four is
// what makes it possible to see it.
//
// ── HOW THIS WAS MEASURED (14 September 2026) ───────────────────────────────────────────────
//
// Against the LIVE database, not the migration files — the migrations are applied by hand here, so
// the files are a plan and pg_policy is the fact:
//
//   SELECT c.relname, p.polcmd, pg_get_expr(p.polqual, p.polrelid)
//   FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
//   JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public';
//
// Every table in public has RLS ENABLED. Six have it enabled with ZERO policies
// (ai_spend_daily, cron_runs, intake_claims, mollie_payment_links, readiness_cache,
// system_events): those are server-owned by construction and no session reaches them at all.
// A route was then read table by table: for each (table, command) it runs through the
// service-role client, does a policy exist that a session could satisfy?
//
// ── WHAT `unproven` MEANS, AND WHAT IT DOES NOT ─────────────────────────────────────────────
//
// It does NOT mean "insecure". Every one of these routes scopes its queries to the session user by
// hand, and the [RLS-UIT] gate encodes that discipline for the money line. It means: RLS could do
// that scoping, and here it is switched off for no reason anybody wrote down — so the hand-written
// filter is the ONLY lock instead of the second one. The EIGHTEEN bank routes in this class are
// the clearest case (twenty routes live under bank/, but bank/attachment and bank/delete-statement
// are rls-gap, not unproven — the first count said nineteen and was simply wrong):
// bank_transactions carries `user_id = auth.uid()` policies for SELECT, INSERT, UPDATE and
// DELETE; bank_tx_invoices carries THREE — select, insert, delete — and has no UPDATE policy at
// all. The first version of this paragraph said four for both and was wrong, which matters
// exactly once and completely: a route switched to the session client on the strength of it would
// have had its UPDATEs match zero rows, silently, on the allocation table. (The grant is there —
// `authenticated` holds UPDATE — so the failure would not be a permission error, it would be a
// no-op.) In practice nothing updates an allocation: the money functions delete and re-insert.
// The one comment on record says
// "service_role is safe here: every query below is pinned to this user's own data" — which is an
// assertion about the code, not a reason for the bypass.
//
// ── AND THE BANK BLOCK WAS NOT LEFT AS A SUSPICION ──────────────────────────────────────────
//
// "RLS could do this" is a claim, so it was executed. Against PRODUCTION, inside an aborted
// transaction, as a real account (one SELECT per table, service-role filtered by hand versus the
// same table read as `authenticated` with that account's jwt claim, which is what a session
// client is):
//
//   SET LOCAL role authenticated;
//   SET LOCAL request.jwt.claims = '{"sub":"<the account>","role":"authenticated"}';
//
//   table               service-role, filtered by hand     session client, under RLS
//   bank_transactions                        1.525                        1.525
//   bank_tx_invoices                           425                          425
//   invoices                                   571                          571
//   suppliers                                   47                           47
//   documents                                  589                          589
//
// Row for row. The bypass buys nothing on the read side of these five tables, which is where the
// bank block spends almost all of its queries. What this does NOT prove: the write side. Those
// policies carry the same `user_id = auth.uid()` expression, so the same reasoning applies — but
// no INSERT, UPDATE or DELETE was executed against production and none will be. Closing the bank
// block is therefore a mechanical change with a known read outcome and a write outcome that needs
// one staging run, not a gamble.
//
// This list is a RATCHET: `unproven` may only shrink. A route leaves it by being moved to the
// session client (best), or by someone writing down which of the other four reasons applies.

/** Why a route outside the money line holds the service-role key. */
export type ServiceRoleClass =
  /** No user session exists: a cron secret, a provider signature, or a per-row token. */
  | "trusted-server"
  /** A human session, but the operation is deliberately about another tenant. */
  | "system-wide"
  /** The (table, command) pair has no RLS policy: a session structurally cannot do it. */
  | "rls-gap"
  /** The row belongs to the other side of a pairing the query proves (accountant↔client, owner↔member). */
  | "other-party"
  /** RLS would allow it; a TRIGGER deliberately refuses the session. */
  | "guard-trigger"
  /** A session, its own rows, and a policy that covers it. No reason on record. */
  | "unproven";

export interface ServiceRoleRoute {
  /** Path under src/app/api, without the trailing /route.ts. */
  route: string;
  klass: ServiceRoleClass;
  /** The fact that decided it — a policy that is missing, a credential that is not a session. */
  why: string;
}

export const SERVICE_ROLE_ROUTES: readonly ServiceRoleRoute[] = [
  { route: "billing/checkout", klass: "guard-trigger",
    why: "profiles_billing_guard refuses the session's own billing columns" },
  { route: "beveiliging", klass: "other-party",
    why: "reads a team member's profile row; profiles_select_own is id = auth.uid()" },
  { route: "clients", klass: "other-party",
    why: "a sales member writes clients under the OWNER's id, set by the server" },
  { route: "closing-package", klass: "other-party",
    why: "the accountant builds the CLIENT's package" },
  { route: "closing-package/share", klass: "other-party",
    why: "the accountant shares the CLIENT's package" },
  { route: "closing-package/vers", klass: "other-party",
    why: "the accountant reads the CLIENT's rows" },
  { route: "company/members", klass: "other-party",
    why: "reads the members' profile rows" },
  { route: "invite/accountant", klass: "other-party",
    why: "reads the invitee's profile row" },
  { route: "invite/client", klass: "other-party",
    why: "reads the invitee's profile row" },
  { route: "logboek", klass: "other-party",
    why: "the accountant reads the CLIENT's audit_logs" },
  { route: "messages", klass: "other-party",
    why: "reads the counterparty's profile row" },
  { route: "messages/conversations", klass: "other-party",
    why: "reads the counterparty's profile row" },
  { route: "settings/accountant", klass: "other-party",
    why: "reads the accountant's profile row from the client's session" },
  { route: "work-done", klass: "other-party",
    why: "the office counts work across its CLIENTS" },
  { route: "bank/attachment", klass: "rls-gap",
    why: "bank_tx_attachments has no INSERT policy" },
  { route: "bank/delete-statement", klass: "rls-gap",
    why: "bank_statement_periods has no DELETE policy" },
  { route: "company/members/accept", klass: "rls-gap",
    why: "company_members has no INSERT policy" },
  { route: "invite/accept", klass: "rls-gap",
    why: "accountant_clients has no INSERT policy; invitations has no UPDATE policy" },
  { route: "invite/cancel", klass: "rls-gap",
    why: "invitations has no UPDATE policy" },
  { route: "invoice-corrections/[id]", klass: "rls-gap",
    why: "invoice_corrections has SELECT-only RLS" },
  { route: "push/subscribe", klass: "rls-gap",
    why: "push_subscriptions has no INSERT policy" },
  { route: "control/toekenning", klass: "system-wide",
    why: "the console grants a plan to an account that is not the operator's" },
  { route: "billing/webhook", klass: "trusted-server",
    why: "Stripe signature; no session exists" },
  { route: "cron/accountant-daily", klass: "trusted-server",
    why: "CRON_SECRET; sweeps every tenant, no session exists" },
  { route: "cron/bank-sync", klass: "trusted-server",
    why: "CRON_SECRET; sweeps every tenant, no session exists" },
  { route: "cron/btw-deadline", klass: "trusted-server",
    why: "CRON_SECRET; sweeps every tenant, no session exists" },
  { route: "cron/email-sync", klass: "trusted-server",
    why: "CRON_SECRET; sweeps every tenant, no session exists" },
  { route: "cron/mollie-settlements", klass: "trusted-server",
    why: "CRON_SECRET; sweeps every tenant, no session exists" },
  { route: "cron/ochtend", klass: "trusted-server",
    why: "CRON_SECRET; sweeps every tenant, no session exists" },
  { route: "cron/payment-due", klass: "trusted-server",
    why: "CRON_SECRET; sweeps every tenant, no session exists" },
  { route: "cron/quarter-close", klass: "trusted-server",
    why: "CRON_SECRET; sweeps every tenant, no session exists" },
  { route: "cron/reconcile", klass: "trusted-server",
    why: "CRON_SECRET; sweeps every tenant, no session exists" },
  { route: "cron/recurring", klass: "trusted-server",
    why: "CRON_SECRET; sweeps every tenant, no session exists" },
  { route: "cron/reminders", klass: "trusted-server",
    why: "CRON_SECRET; sweeps every tenant, no session exists" },
  { route: "cron/retention-purge", klass: "trusted-server",
    why: "CRON_SECRET; sweeps every tenant, no session exists" },
  { route: "health", klass: "trusted-server",
    why: "CRON_SECRET; no session exists" },
  { route: "invite/decline", klass: "trusted-server",
    why: "the invitation token IS the credential; no session exists" },
  { route: "invite/info", klass: "trusted-server",
    why: "the invitation token IS the credential; no session exists" },
  { route: "offerte/[token]", klass: "trusted-server",
    why: "the quote token IS the credential; no session exists" },
  { route: "pakket", klass: "trusted-server",
    why: "the package share token IS the credential; no session exists" },
  { route: "account/delete", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "account/export", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "articles", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "articles/[id]", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "bank/allocate", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "bank/attach-invoice", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "bank/auto-confirm", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "bank/categorize", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "bank/confirm", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "bank/delete-line", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "bank/enablebanking/sync", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "bank/ignore", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "bank/ignored", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "bank/line-invoice", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "bank/match", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "bank/match-checked", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "bank/reconciliation", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "bank/refresh-names", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "bank/rematch", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "bank/storno", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "bank/unlink", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "bank/upload", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "btw-reservation", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "cashflow", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "daily-truth", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "feedback", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "geleerd", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "grootboek", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "grootboek/kaart", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "ib-jaar", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "money-audit", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "onboarding/reset", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "push/unsubscribe", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "reconcile/run", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "ritten", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "supplier/incasso", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "truth", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "uren", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "wachtkoppeling", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
  { route: "xaf", klass: "unproven",
    why: "a session, its own rows, and an owner policy for every table it touches" },
];

/**
 * How many routes each class may hold.
 *
 * Pinned EXACTLY, like the frozen classes in register.ts: moving a route between classes is a
 * decision, and a decision should be an edit somebody can see in a diff. `unproven` is the only
 * one meant to move, and only downwards.
 */
export const SERVICE_ROLE_CEILINGS: Readonly<Record<ServiceRoleClass, number>> = {
  "trusted-server": 18,
  "system-wide": 1,
  "rls-gap": 7,
  "other-party": 13,
  "guard-trigger": 1,
  "unproven": 40,
};

/**
 * The order to close `unproven` in, decided once so it is not re-argued per route.
 *
 * The bank block first, because it is eighteen of the forty and they all touch the same two
 * tables with the same owner policies — one change of client, one gate, eighteen routes. Then the
 * read-only reporting routes, which cannot corrupt anything if the switch is wrong. Then the rest,
 * one at a time.
 */
export const UNPROVEN_ORDER: readonly string[] = [
  "the bank block (18): bank_transactions and bank_tx_invoices carry full owner CRUD policies",
  "the reporting reads (cashflow, daily-truth, geleerd, grootboek, ib-jaar, money-audit, truth, uren, xaf)",
  "the remainder, one route at a time, each with its own measurement",
];

// ── THE BACKLOG, SO THAT "40 WITH NO REASON" DOES NOT BECOME A PERMANENT STATE ───────────────
//
// A classification is a snapshot. A snapshot that nobody is assigned to act on is a note, and a
// note is what "temporarily" looked like for the four legacy mechanisms in register.ts. So the
// forty carry a BATCH (when they move), an OWNER (which part of the product moves them) and the
// EVIDENCE that has to exist before one of them may be reclassified.
//
// `expectedClass` is deliberately "unproven" for every row today. It is not a prediction: guessing
// where a route will land is how a survey becomes a story. A row changes class only after the
// evidence named beside it exists, and then it moves in SERVICE_ROLE_ROUTES and its ceiling drops.

export interface ServiceRoleBacklogItem {
  route: string;
  /** Which batch closes it. Batches are ordered; a route is not picked out of order. */
  batch: "bank-1" | "reporting-2" | "rest-3";
  /** Which part of the product owns closing it — a name somebody can be. */
  owner: string;
  /** Where it is expected to land. Always "unproven" until the evidence exists. */
  expectedClass: ServiceRoleClass;
  /** What has to be MEASURED before this row may move. Not an intention — a measurement. */
  evidenceNeeded: string;
}

export const SERVICE_ROLE_BACKLOG: readonly ServiceRoleBacklogItem[] = [
  { route: "bank/allocate", batch: "bank-1", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "one staging run of this route on the session client, with the row counts before and after" },
  { route: "bank/attach-invoice", batch: "bank-1", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "one staging run of this route on the session client, with the row counts before and after" },
  { route: "bank/auto-confirm", batch: "bank-1", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "one staging run of this route on the session client, with the row counts before and after" },
  { route: "bank/categorize", batch: "bank-1", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "one staging run of this route on the session client, with the row counts before and after" },
  { route: "bank/confirm", batch: "bank-1", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "one staging run of this route on the session client, with the row counts before and after" },
  { route: "bank/delete-line", batch: "bank-1", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "one staging run of this route on the session client, with the row counts before and after" },
  { route: "bank/enablebanking/sync", batch: "bank-1", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "one staging run of this route on the session client, with the row counts before and after" },
  { route: "bank/ignore", batch: "bank-1", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "one staging run of this route on the session client, with the row counts before and after" },
  { route: "bank/ignored", batch: "bank-1", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "one staging run of this route on the session client, with the row counts before and after" },
  { route: "bank/line-invoice", batch: "bank-1", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "one staging run of this route on the session client, with the row counts before and after" },
  { route: "bank/match", batch: "bank-1", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "one staging run of this route on the session client, with the row counts before and after" },
  { route: "bank/match-checked", batch: "bank-1", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "one staging run of this route on the session client, with the row counts before and after" },
  { route: "bank/reconciliation", batch: "bank-1", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "one staging run of this route on the session client, with the row counts before and after" },
  { route: "bank/refresh-names", batch: "bank-1", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "one staging run of this route on the session client, with the row counts before and after" },
  { route: "bank/rematch", batch: "bank-1", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "one staging run of this route on the session client, with the row counts before and after" },
  { route: "bank/storno", batch: "bank-1", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "one staging run of this route on the session client, with the row counts before and after" },
  { route: "bank/unlink", batch: "bank-1", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "one staging run of this route on the session client, with the row counts before and after" },
  { route: "bank/upload", batch: "bank-1", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "one staging run of this route on the session client, with the row counts before and after" },
  { route: "btw-reservation", batch: "reporting-2", owner: "Reporting & Aangifte",
    expectedClass: "unproven", evidenceNeeded: "a read-only diff: the same request answered on the session client and on service_role, row for row" },
  { route: "cashflow", batch: "reporting-2", owner: "Reporting & Aangifte",
    expectedClass: "unproven", evidenceNeeded: "a read-only diff: the same request answered on the session client and on service_role, row for row" },
  { route: "daily-truth", batch: "reporting-2", owner: "Reporting & Aangifte",
    expectedClass: "unproven", evidenceNeeded: "a read-only diff: the same request answered on the session client and on service_role, row for row" },
  { route: "geleerd", batch: "reporting-2", owner: "Reporting & Aangifte",
    expectedClass: "unproven", evidenceNeeded: "a read-only diff: the same request answered on the session client and on service_role, row for row" },
  { route: "grootboek", batch: "reporting-2", owner: "Reporting & Aangifte",
    expectedClass: "unproven", evidenceNeeded: "a read-only diff: the same request answered on the session client and on service_role, row for row" },
  { route: "grootboek/kaart", batch: "reporting-2", owner: "Reporting & Aangifte",
    expectedClass: "unproven", evidenceNeeded: "a read-only diff: the same request answered on the session client and on service_role, row for row" },
  { route: "ib-jaar", batch: "reporting-2", owner: "Reporting & Aangifte",
    expectedClass: "unproven", evidenceNeeded: "a read-only diff: the same request answered on the session client and on service_role, row for row" },
  { route: "money-audit", batch: "reporting-2", owner: "Reporting & Aangifte",
    expectedClass: "unproven", evidenceNeeded: "a read-only diff: the same request answered on the session client and on service_role, row for row" },
  { route: "truth", batch: "reporting-2", owner: "Reporting & Aangifte",
    expectedClass: "unproven", evidenceNeeded: "a read-only diff: the same request answered on the session client and on service_role, row for row" },
  { route: "uren", batch: "reporting-2", owner: "Work",
    expectedClass: "unproven", evidenceNeeded: "a read-only diff: the same request answered on the session client and on service_role, row for row" },
  { route: "xaf", batch: "reporting-2", owner: "Reporting & Aangifte",
    expectedClass: "unproven", evidenceNeeded: "a read-only diff: the same request answered on the session client and on service_role, row for row" },
  { route: "account/delete", batch: "rest-3", owner: "Platform",
    expectedClass: "unproven", evidenceNeeded: "read the route, name every (table, command) it runs, and check each against pg_policy" },
  { route: "account/export", batch: "rest-3", owner: "Platform",
    expectedClass: "unproven", evidenceNeeded: "read the route, name every (table, command) it runs, and check each against pg_policy" },
  { route: "articles", batch: "rest-3", owner: "Product & Item",
    expectedClass: "unproven", evidenceNeeded: "read the route, name every (table, command) it runs, and check each against pg_policy" },
  { route: "articles/[id]", batch: "rest-3", owner: "Product & Item",
    expectedClass: "unproven", evidenceNeeded: "read the route, name every (table, command) it runs, and check each against pg_policy" },
  { route: "feedback", batch: "rest-3", owner: "Platform",
    expectedClass: "unproven", evidenceNeeded: "read the route, name every (table, command) it runs, and check each against pg_policy" },
  { route: "onboarding/reset", batch: "rest-3", owner: "Platform",
    expectedClass: "unproven", evidenceNeeded: "read the route, name every (table, command) it runs, and check each against pg_policy" },
  { route: "push/unsubscribe", batch: "rest-3", owner: "Platform",
    expectedClass: "unproven", evidenceNeeded: "read the route, name every (table, command) it runs, and check each against pg_policy" },
  { route: "reconcile/run", batch: "rest-3", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "read the route, name every (table, command) it runs, and check each against pg_policy" },
  { route: "ritten", batch: "rest-3", owner: "Work",
    expectedClass: "unproven", evidenceNeeded: "read the route, name every (table, command) it runs, and check each against pg_policy" },
  { route: "supplier/incasso", batch: "rest-3", owner: "Supplier & Direct Debit",
    expectedClass: "unproven", evidenceNeeded: "read the route, name every (table, command) it runs, and check each against pg_policy" },
  { route: "wachtkoppeling", batch: "rest-3", owner: "Bank & Reconciliation",
    expectedClass: "unproven", evidenceNeeded: "read the route, name every (table, command) it runs, and check each against pg_policy" },
];

/** How many routes each batch holds today. Pinned, and only ever lowered. */
export const BACKLOG_BATCHES: Readonly<Record<string, number>> = {
  "bank-1": 18,
  "reporting-2": 11,
  "rest-3": 11,
};

// ── THE SEVEN RLS GAPS ARE NOT ALL THE SAME KIND OF GAP ─────────────────────────────────────
//
// "The command has no policy" is a measurement, not a verdict. Five of the seven are a policy
// somebody never wrote; two — three, counting one table twice — are the DESIGN, because the right
// to act is proved by a TOKEN in the request body and RLS cannot see a request body. Treating
// those as debt would mean writing a policy that says "anyone may update any invitation", which is
// the opposite of a fix.
//
// This is the list the owner asked to keep as remediation rather than let it read as "everything
// is fine because the reads matched".

export type RlsGapVerdict = "close-with-policy" | "is-the-design";

export interface RlsGapItem {
  table: string;
  command: string;
  routes: readonly string[];
  verdict: RlsGapVerdict;
  why: string;
  /** For close-with-policy: the shape the policy would take. Empty when it is the design. */
  policyShape: string;
}

export const RLS_GAP_REMEDIATION: readonly RlsGapItem[] = [
  {
    table: "bank_tx_invoices",
    command: "UPDATE",
    routes: [],
    verdict: "is-the-design",
    why: "Three policies exist — select, insert, delete — and no UPDATE. That is not an omission: " +
      "an allocation is never edited. Every money function that changes one DELETEs the row and " +
      "INSERTs a replacement inside the same locked transaction, because a payment that moved is " +
      "two events and not a changed field. An UPDATE policy would make a fourth way to change " +
      "amount_applied, beside the three the invariant is proved over. The `authenticated` role " +
      "does hold the UPDATE grant, so an UPDATE from a session is a silent no-op rather than a " +
      "permission error — worth knowing before anybody switches a route to the session client.",
    policyShape: "",
  },
  {
    table: "bank_tx_attachments",
    command: "INSERT and DELETE",
    routes: ["bank/attachment"],
    verdict: "close-with-policy",
    why: "The owner attaching their own receipt to their own bank line. The table already has " +
      "bank_tx_attachments_owner_read for SELECT; the write half was never written.",
    policyShape: "user_id = auth.uid(), mirroring bank_tx_invoices_insert_own / _delete_own",
  },
  {
    table: "bank_statement_periods",
    command: "DELETE",
    routes: ["bank/delete-statement"],
    verdict: "close-with-policy",
    why: "The owner deleting their own imported statement period. bsp_owner_read covers reading " +
      "it and nothing covers removing it.",
    policyShape: "the same expression bsp_owner_read already uses, as a DELETE policy",
  },
  {
    table: "push_subscriptions",
    command: "INSERT",
    routes: ["push/subscribe"],
    verdict: "close-with-policy",
    why: "SELECT and DELETE own-policies exist and INSERT does not — a plain omission. The route " +
      "upserts user_id = user.id, so the policy would refuse nothing it does today.",
    policyShape: "user_id = auth.uid() WITH CHECK, beside the existing select/delete pair",
  },
  {
    table: "invoice_corrections",
    command: "UPDATE",
    routes: ["invoice-corrections/[id]"],
    verdict: "close-with-policy",
    why: "Two SELECT policies exist (accountant side and client side) and no UPDATE. The client " +
      "accepting or rejecting a proposal is their own row on their own invoice. Care is owed: " +
      "this route also holds an applying_since LEASE, and a policy must not make the lease " +
      "release path unreachable.",
    policyShape: "client_id = auth.uid() for the decision; the lease columns stay server-written",
  },
  {
    table: "invitations",
    command: "UPDATE — the CANCEL direction only",
    routes: ["invite/cancel"],
    verdict: "close-with-policy",
    why: "invite/cancel has a session and already filters .eq('zzper_id', user.id): a policy " +
      "would express exactly that. It does NOT close the table, because accept and decline on the " +
      "same table are token-proved — see the row below. Half a table is closeable and half is not, " +
      "and saying so is the point of this list.",
    policyShape: "zzper_id = auth.uid() AND status = 'pending', for UPDATE only",
  },
  {
    table: "invitations",
    command: "UPDATE — the ACCEPT and DECLINE directions",
    routes: ["invite/accept", "invite/decline"],
    verdict: "is-the-design",
    why: "The invitation TOKEN is the credential. invite/decline has no session at all — the " +
      "person clicking the link may not have an account — and invite/accept proves the token " +
      "before it will touch the row. RLS cannot see a token in a request body, so a policy that " +
      "allowed these would have to allow everyone.",
    policyShape: "",
  },
  {
    table: "accountant_clients",
    command: "INSERT",
    routes: ["invite/accept"],
    verdict: "is-the-design",
    why: "The row that pairs an accountant with a client is created by redeeming an invitation " +
      "token. A session policy would have to say 'any accountant may add any client', which is " +
      "the exact grant the invitation exists to withhold.",
    policyShape: "",
  },
  {
    table: "company_members",
    command: "INSERT",
    routes: ["company/members/accept"],
    verdict: "is-the-design",
    why: "The same shape, and the header of that route says it in full: this row is what puts " +
      "somebody inside another company's administration, under another company's BTW number. The " +
      "table carries the invite's HASH and the link carries the secret; a policy cannot check a " +
      "secret it never sees.",
    policyShape: "",
  },
];

/**
 * ── WHAT THE PRODUCTION MEASUREMENT DID AND DID NOT PROVE ───────────────────────────────────
 *
 * Kept as a named export rather than a comment, so that a gate can assert it is still here and a
 * reader looking for "is the service-role work finished" finds the honest answer first.
 *
 * The read parity measured above (five tables, row for row, on a real account) proves exactly one
 * thing: for those SELECTs, RLS returns what the hand-written filter returns. It does not prove:
 *
 *   · that the WRITES are equivalent. The policies carry the same `user_id = auth.uid()`
 *     expression, which is a good reason to expect it, and an expectation is not a measurement.
 *   · that every route's queries are covered. Parity was measured per TABLE, not per query; a
 *     route joining or filtering in a way no policy anticipated would still change behaviour.
 *   · anything about the 22 routes outside the unproven class. Those have reasons, not parity.
 *
 * What would prove the write side: one staging run per batch that performs the route's real
 * INSERT/UPDATE/DELETE on the session client and compares the resulting rows. Not production.
 */
export const WRITE_SIDE_NOT_PROVEN =
  "Read parity is not write safety. The service-role classification is complete; the service-role " +
  "MIGRATION is not, and this constant exists so that nobody can read the first as the second.";
