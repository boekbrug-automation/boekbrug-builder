-- migrations: accountant_directory.sql, accountant_directory_talen.sql, accountant_directory_requires_accountant_role.sql
-- =====================================================================
-- [KANTOORGIDS-ROL] Who may write the public office directory, tried — not read.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- The static gates in lifecycle-gates.test.ts read the migration TEXT. They cannot tell whether a
-- policy actually refuses anything, and the hole this file is about was invisible to exactly that
-- kind of reading: `WITH CHECK (accountant_id = auth.uid())` looks like an ownership guard and IS
-- one — it simply never asked whether the owner is an accountant. Only an attempt shows it.
--
-- So every assertion below is an ATTEMPT, from an impersonated session under SET ROLE authenticated
-- (or anon), with RLS on. Setup and read-back run as the owner, which RLS never applies to.
--
-- TWO THINGS THE FIXTURE MUST GET RIGHT, or this file proves nothing:
--
--   1. profiles carries RLS here, with production's own-row read policy. The new write policies ask
--      `EXISTS (SELECT 1 FROM profiles …)`, and that subquery runs under the CALLER's rights. On a
--      fixture where profiles has no RLS the EXISTS would succeed for reasons production does not
--      have, and the test would be green in a world where the bug cannot exist.
--   2. accountant_directory is created by the migration, i.e. AFTER fixture.sql hands out its
--      table grants. Without an explicit grant here every write fails for lack of privilege rather
--      than for lack of a policy — which looks identical in the result and means something else.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;

-- (1) profiles as production has it: RLS on, own row readable.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated USING (id = (select auth.uid()));

-- (2) the grants the real Data API has on this table.
GRANT USAGE ON SCHEMA public, auth TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accountant_directory TO authenticated;
GRANT SELECT ON public.accountant_directory TO anon;
GRANT SELECT ON public.profiles TO authenticated;

-- ── The world: two accountants and one ondernemer ────────────────────────────────────────────
INSERT INTO public.profiles (id, role) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'accountant'),   -- A
  ('b0000000-0000-0000-0000-00000000000b', 'accountant'),   -- B
  ('20000000-0000-0000-0000-000000000002', 'zzper');        -- Z, an ordinary owner

-- =============================================================================================
-- THE HOLE: an ordinary owner writing themselves into the list of offices
-- =============================================================================================
SET ROLE authenticated;

-- 8. A non-accountant may not ESTABLISH a listing. Before this migration this INSERT succeeded:
--    the policy asked only that the uuid be the caller's own, and Z's uuid is.
SELECT set_config('test.uid', '20000000-0000-0000-0000-000000000002', false);
DO $$ BEGIN
  INSERT INTO public.accountant_directory (accountant_id, office_name, city, contact_email, languages)
  VALUES ('20000000-0000-0000-0000-000000000002', 'Niet Een Kantoor', 'Utrecht', 'z@z.nl', ARRAY['nl']);
  RAISE EXCEPTION '[KANTOORGIDS-ROL] an ondernemer INSERTED a directory listing — the hole is open';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '   ok · a non-accountant cannot establish a listing (42501)';
END $$;

-- 9a. …and may not publish one either. Seeded as the owner so the row exists at all: this is the
--     "role changed after the listing was made" case, which is the one G says must not be trapped.
RESET ROLE;
INSERT INTO public.accountant_directory (accountant_id, office_name, city, contact_email, languages, published)
VALUES ('20000000-0000-0000-0000-000000000002', 'Ooit Een Kantoor', 'Utrecht', 'z@z.nl', ARRAY['nl'], false);
SET ROLE authenticated;

SELECT set_config('test.uid', '20000000-0000-0000-0000-000000000002', false);
DO $$ BEGIN
  UPDATE public.accountant_directory SET published = true
   WHERE accountant_id = '20000000-0000-0000-0000-000000000002';
  RAISE EXCEPTION '[KANTOORGIDS-ROL] a non-accountant PUBLISHED a listing';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '   ok · a non-accountant cannot publish an existing listing (42501)';
END $$;

-- =============================================================================================
-- [KANTOORGIDS-ROL] …and is still not trapped: the row stays correctable and removable
-- =============================================================================================

-- 9b. Editing the row while it stays UNPUBLISHED is allowed — the guard is on publishing, not on
--     touching. A listing its own office can neither fix nor take down would be worse than the
--     hole above.
DO $$
DECLARE n int;
BEGIN
  UPDATE public.accountant_directory SET city = 'Amersfoort'
   WHERE accountant_id = '20000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '[KANTOORGIDS-ROL] a non-accountant cannot correct their own unpublished row (% rows)', n; END IF;
  RAISE NOTICE '   ok · an unpublished row stays correctable by its owner';
END $$;

-- 9c. And UNPUBLISHING is never blocked. Seeded published as the owner to reach the state a
--     demotion leaves behind: listed, and no longer an accountant.
RESET ROLE;
UPDATE public.accountant_directory SET published = true
 WHERE accountant_id = '20000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
SELECT set_config('test.uid', '20000000-0000-0000-0000-000000000002', false);
DO $$
DECLARE n int;
BEGIN
  UPDATE public.accountant_directory SET published = false
   WHERE accountant_id = '20000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '[KANTOORGIDS-ROL] a non-accountant is TRAPPED — cannot unpublish (% rows)', n; END IF;
  RAISE NOTICE '   ok · unpublishing is never blocked, whatever the role';
END $$;

-- 9d. …and neither is deleting. This is the escape hatch that makes the guard safe to ship.
DO $$
DECLARE n int;
BEGIN
  DELETE FROM public.accountant_directory WHERE accountant_id = '20000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '[KANTOORGIDS-ROL] a non-accountant cannot delete their own listing (% rows)', n; END IF;
  RAISE NOTICE '   ok · an own listing can always be removed';
END $$;

-- =============================================================================================
-- The accountant's own writes still work — this is also the file's control
-- =============================================================================================

-- 10. A real accountant writes their own listing, with a language, and publishes it.
SELECT set_config('test.uid', 'a0000000-0000-0000-0000-00000000000a', false);
DO $$ BEGIN
  INSERT INTO public.accountant_directory (accountant_id, office_name, city, contact_email, languages, published)
  VALUES ('a0000000-0000-0000-0000-00000000000a', 'Kantoor A', 'Utrecht', 'a@a.nl', ARRAY['nl','ar'], true);
  RAISE NOTICE '   ok · an accountant publishes a complete listing with a language';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION '[KANTOORGIDS-ROL] the guard refuses a real accountant — the control failed';
END $$;

-- 11. A cannot write B's row. USING pins the row to its owner, so this matches NOTHING rather
--     than raising: a refusal by invisibility, which is the right shape for a row that is not
--     yours to know about.
RESET ROLE;
INSERT INTO public.accountant_directory (accountant_id, office_name, city, contact_email, languages, published)
VALUES ('b0000000-0000-0000-0000-00000000000b', 'Kantoor B', 'Zwolle', 'b@b.nl', ARRAY['nl'], true);
SET ROLE authenticated;
SELECT set_config('test.uid', 'a0000000-0000-0000-0000-00000000000a', false);
DO $$
DECLARE n int;
BEGIN
  UPDATE public.accountant_directory SET office_name = 'Overgenomen'
   WHERE accountant_id = 'b0000000-0000-0000-0000-00000000000b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION '[KANTOORGIDS-ROL] accountant A wrote accountant B''s listing (% rows)', n; END IF;
  -- And the insert direction: claiming a row in someone else's name.
  BEGIN
    INSERT INTO public.accountant_directory (accountant_id, office_name, city, contact_email, languages)
    VALUES ('b0000000-0000-0000-0000-00000000000b', 'Gekaapt', 'Zwolle', 'x@x.nl', ARRAY['nl']);
    RAISE EXCEPTION '[KANTOORGIDS-ROL] accountant A INSERTED a listing owned by B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE '   ok · one accountant cannot write another''s listing, in either direction';
END $$;

-- =============================================================================================
-- [KANTOORGIDS-TAAL] The language contract, at the database boundary
-- =============================================================================================

-- 1/2. Publishing with no language is refused — the defect this whole batch repairs. The route
--      used to send exactly this row, and the 23514 arrived at the office as a bare 503.
SELECT set_config('test.uid', 'a0000000-0000-0000-0000-00000000000a', false);
DO $$ BEGIN
  UPDATE public.accountant_directory SET languages = ARRAY[]::text[]
   WHERE accountant_id = 'a0000000-0000-0000-0000-00000000000a';
  RAISE EXCEPTION '[KANTOORGIDS-TAAL] a PUBLISHED listing was left with no language';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '   ok · a published listing cannot be stripped of its last language (23514)';
END $$;

-- 3. A DRAFT with no language is fine — accountant_directory_published_has_language is gated on
--    `published`, and a draft is allowed to be unfinished. As B, on B's own row: RLS pins every
--    write to its owner, so the language contract has to be exercised by whoever owns the row.
SELECT set_config('test.uid', 'b0000000-0000-0000-0000-00000000000b', false);
DO $$ BEGIN
  INSERT INTO public.accountant_directory (accountant_id, office_name, city, contact_email, languages, published)
  VALUES ('b0000000-0000-0000-0000-00000000000b', 'x', 'x', 'x@x.nl', ARRAY[]::text[], false)
  ON CONFLICT (accountant_id) DO UPDATE SET languages = ARRAY[]::text[], published = false;
  RAISE NOTICE '   ok · a draft may name no language';
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION '[KANTOORGIDS-TAAL] a draft was refused for having no language';
END $$;

-- 4. An unknown code is refused — in a DRAFT too, because accountant_directory_languages_known is
--    not conditional on `published`. This is why the route validates languages on every write and
--    not only when publishing.
DO $$ BEGIN
  UPDATE public.accountant_directory SET languages = ARRAY['nl','de']
   WHERE accountant_id = 'b0000000-0000-0000-0000-00000000000b';
  RAISE EXCEPTION '[KANTOORGIDS-TAAL] an unknown language code was stored';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '   ok · an unknown language is refused, in a draft as well (23514)';
END $$;

-- =============================================================================================
-- The read side did not move
-- =============================================================================================
RESET ROLE;
UPDATE public.accountant_directory SET published = false
 WHERE accountant_id = 'b0000000-0000-0000-0000-00000000000b';

-- 12/13. Anonymous sees published rows and nothing else. B's row is a draft, so it must be
--        invisible — not redacted, absent.
SET ROLE anon;
SELECT set_config('test.uid', '', false);
DO $$
DECLARE ids uuid[];
BEGIN
  SELECT coalesce(array_agg(accountant_id ORDER BY accountant_id), '{}')
    INTO ids FROM public.accountant_directory;
  IF ids <> ARRAY['a0000000-0000-0000-0000-00000000000a']::uuid[] THEN
    RAISE EXCEPTION '[KANTOORGIDS] anon sees the wrong rows: %', ids;
  END IF;
  RAISE NOTICE '   ok · anon reads only published rows, and the unpublished one is absent';
END $$;

-- …and anon may not write, at all. Named because the grants above hand anon a SELECT and it would
-- be easy to hand it more.
DO $$ BEGIN
  INSERT INTO public.accountant_directory (accountant_id, office_name, city, contact_email, languages)
  VALUES ('a0000000-0000-0000-0000-00000000000a', 'anon', 'x', 'x@x.nl', ARRAY['nl']);
  RAISE EXCEPTION '[KANTOORGIDS] anon INSERTED into the directory';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '   ok · anon cannot write the directory';
END $$;

RESET ROLE;
SELECT '[KANTOORGIDS-ROL] held: only an accountant establishes or publishes a listing, nobody is trapped in one, and the read side is unchanged' AS result;
