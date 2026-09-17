-- =====================================================================
-- [PROEF-WERKPLEK] Free IS the trial, so the 90-day welcome Plus retires.
-- BoekBrug · September 2026
-- =====================================================================
-- THE MODEL HAD THREE TRIALS STACKED ON ONE ANOTHER.
--
-- A new account got Free, plus a 90-day welcome grant of Plus, and the billing surface carried a
-- Stripe trial on top of that. Three layers aiming at the same thing: let somebody find out
-- whether the product is for them. The owner's decision collapses that to one.
--
--   Free lets you try BoekBrug.  Plus lets you run your business on BoekBrug.
--
-- Free is now an explicit contract — 5 invoices, 10 AI-read documents, 50 MB, 1 mailbox — and it
-- is deliberately not enough to run a year on. That is the trial. Handing every new account 90
-- days of Plus on top of it does not add a trial; it hides the one we have, and it hides it for
-- exactly as long as it takes a habit to form, so the limits arrive as a loss rather than as the
-- product's shape.
--
-- ── WHAT THIS DOES NOT DO, AND THAT IS THE WHOLE CARE OF IT ──
-- It drops the TRIGGER. It does not touch one existing row.
--
-- Grants already handed out keep running to their own expiry date and then simply stop. Nobody is
-- cut short, no date is rewritten, and no account wakes up tomorrow with less than it had
-- yesterday. Four are live as this is written (expiring 22 Oct, 24 Nov, 11 Dec and 15 Dec 2026);
-- they expire on their own and the account continues under the Free contract.
--
-- ── THE PERMANENT GRANTS MUST SURVIVE ──
-- plan_grants also holds rows with expires_at IS NULL — Kiwi Food carries one, «Eigen winkel van
-- de eigenaar — open toegang, geen einddatum». Those are not welcome periods and have nothing to
-- do with this change. Dropping the trigger cannot reach them, and grantStanding() reads a NULL
-- expiry as "no end date" rather than as expired. A gate in lifecycle-gates.test.ts pins that,
-- because it is the one way a pricing change could silently take the owner's own shop away.
--
-- ── REVERSIBLE IN ONE STATEMENT ──
-- grant_welcome_plus() is deliberately LEFT IN PLACE. If a welcome period ever becomes a
-- deliberate commercial choice again, re-creating the trigger is the whole change — and keeping
-- the function makes that obvious to whoever reads this file next, instead of making them
-- reconstruct it from a migration that deleted everything.
--
-- APPLY: run in the Supabase SQL editor. No data deleted. Idempotent.
-- Depends on plan_grants.sql.
-- =====================================================================

BEGIN;

DROP TRIGGER IF EXISTS profiles_welcome_plus ON public.profiles;

COMMENT ON FUNCTION public.grant_welcome_plus() IS
  '[PROEF-WERKPLEK] RETIRED as an automatic grant — no trigger calls this. Free is the trial now. Kept, not dropped, so re-arming a welcome period is one CREATE TRIGGER rather than an archaeology exercise.';

COMMIT;

-- =====================================================================
-- VERIFY (run separately after applying):
--
-- 1. The trigger is gone and nothing else on profiles moved:
--      SELECT tgname FROM pg_trigger
--       WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal;
--      -- expect: no row named profiles_welcome_plus
--
-- 2. The function is still there, and says so:
--      SELECT obj_description('public.grant_welcome_plus()'::regprocedure, 'pg_proc');
--
-- 3. NOT ONE GRANT WAS TOUCHED. Compare against the count taken before applying:
--      SELECT count(*) AS total,
--             count(*) FILTER (WHERE expires_at IS NULL) AS permanent,
--             count(*) FILTER (WHERE expires_at > now()) AS still_running
--        FROM public.plan_grants;
--      -- as of 17 September 2026: total 9, permanent 1, still_running 4
--
-- 4. A new signup gets NO grant (run on scratch, never on production):
--      -- insert a profile row, then:
--      -- SELECT count(*) FROM public.plan_grants WHERE user_id = '<the new id>';  -> 0
--
-- ── ROLLBACK ────────────────────────────────────────────────────────
--   CREATE TRIGGER profiles_welcome_plus
--     AFTER INSERT ON public.profiles
--     FOR EACH ROW EXECUTE FUNCTION public.grant_welcome_plus();
-- =====================================================================
