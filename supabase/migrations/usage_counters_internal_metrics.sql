-- =====================================================================
-- [EIGEN-AANDEEL] An `internal.` counter is ours, not the account's.
-- BoekBrug · September 2026
-- =====================================================================
-- WHY THIS EXISTS AT ALL.
--
-- The per-account daily AI share is kept in `usage_counters` — the table that already holds
-- the published fair-use counters — because that table already does everything the share
-- needs: a per-account key, the period IN the key, an atomic check-and-increment that takes
-- the limit as a parameter and refuses without incrementing, and a matching release. Adding
-- a second table would have meant a second set of races to reason about for no new capability.
--
-- But the table carries one thing the share must not inherit. `usage_counters_select_own`
-- lets a logged-in user read EVERY row that is theirs, with no filter on which metric — and
-- it has to, because /eerlijk-gebruik shows them where they stand. The share row is not that
-- kind of number: it is our cost model, in micro-euros, per document read. An owner reading
-- their own row would learn what each of their invoices costs us to the cent.
--
-- ── THE FIX IS A PREFIX, NOT A LIST ──
-- The policy could have named the two published metrics. It does not, deliberately: a list
-- of what is ALLOWED drifts the day someone publishes a third counter and forgets the
-- policy — and it drifts SILENTLY, as an empty meter on the user's own screen. A rule about
-- what is HIDDEN cannot fail that way. Every internal counter is spelled `internal.<name>`,
-- every published one is not, and a metric added tomorrow is visible unless it says it is ours.
--
-- ── WHAT THIS IS NOT ──
-- Not a secret. service_role reads and writes these rows exactly as before, which is the only
-- way they are ever written (fair_use_consume / fair_use_release are SECURITY DEFINER and
-- `authenticated` has no EXECUTE on either). This migration changes one thing only: what a
-- logged-in browser can SELECT.
--
-- Two other reasons already kept the share out of the fair-use screen, and they are
-- independent of this one — measureUsage() filters on COUNTED_METRICS, and it asks for
-- period 'YYYY-MM' where the share is keyed by 'YYYY-MM-DD'. This is the third, and it is the
-- only one that holds against a client that queries the table directly.
--
-- APPLY: run in the Supabase SQL editor. No data deleted. Idempotent.
-- Depends on fair_use_usage.sql (public.usage_counters).
-- =====================================================================

BEGIN;

DROP POLICY IF EXISTS usage_counters_select_own ON public.usage_counters;
CREATE POLICY usage_counters_select_own ON public.usage_counters
  FOR SELECT USING (
    user_id = (SELECT auth.uid())
    AND metric NOT LIKE 'internal.%'
  );

COMMENT ON COLUMN public.usage_counters.metric IS
  '[EIGEN-AANDEEL] A published fair-use metric (aiDocuments, invoicesSent) or an internal one. A metric spelled internal.<name> is OURS: the same table, the same atomicity, but usage_counters_select_own hides it from the account it belongs to.';

COMMIT;

-- =====================================================================
-- VERIFY (run separately after applying):
--
-- 1. The policy carries the prefix rule:
--      select qual from pg_policies
--       where schemaname='public' and tablename='usage_counters'
--         and policyname='usage_counters_select_own';
--      -- expect the qual to contain:  metric !~~ 'internal.%'
--
-- 2. A published counter is still readable by its owner, an internal one is not. Run as a
--    logged-in user (anon key + a session), NOT as service_role, which bypasses RLS:
--      select metric from public.usage_counters;
--      -- expect: aiDocuments / invoicesSent rows only; no 'internal.' row, ever.
--
-- 3. The server still sees both (service_role, RLS bypassed):
--      select metric, count(*) from public.usage_counters group by 1;
--
-- ── ROLLBACK ────────────────────────────────────────────────────────
--   DROP POLICY usage_counters_select_own ON public.usage_counters;
--   CREATE POLICY usage_counters_select_own ON public.usage_counters
--     FOR SELECT USING (user_id = (SELECT auth.uid()));
--   -- NOTE: this restores the leak described in the header. Only do it if the share has
--   -- been moved out of this table entirely.
-- =====================================================================
