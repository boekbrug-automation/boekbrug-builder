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
// filter is the ONLY lock instead of the second one. The nineteen bank routes are the clearest
// case: bank_transactions and bank_tx_invoices both carry `user_id = auth.uid()` policies for
// SELECT, INSERT, UPDATE and DELETE, and the one comment on record says
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
 * The bank block first, because it is nineteen of the forty and they all touch the same two
 * tables with the same owner policies — one change of client, one gate, nineteen routes. Then the
 * read-only reporting routes, which cannot corrupt anything if the switch is wrong. Then the rest,
 * one at a time.
 */
export const UNPROVEN_ORDER: readonly string[] = [
  "the bank block (19): bank_transactions and bank_tx_invoices carry full owner CRUD policies",
  "the reporting reads (cashflow, daily-truth, geleerd, grootboek, ib-jaar, money-audit, truth, uren, xaf)",
  "the remainder, one route at a time, each with its own measurement",
];
