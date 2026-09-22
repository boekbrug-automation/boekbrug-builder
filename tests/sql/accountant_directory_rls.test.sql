-- migrations: accountant_directory.sql, accountant_directory_talen.sql, accountant_directory_publish_requires_client_link.sql
-- =====================================================================
-- [KANTOORGIDS-BEWIJS] Who may make a directory listing PUBLIC, tried — not read.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- The static gates in lifecycle-gates.test.ts read the migration TEXT. They cannot tell whether a
-- policy refuses anything, and the hole this file is about was invisible to exactly that kind of
-- reading: `WITH CHECK (accountant_id = auth.uid())` looks like an ownership guard and IS one — it
-- simply never asked whether the owner is an office. Only an attempt shows it.
--
-- An earlier version of this file tested the FIRST attempt at that guard, which asked
-- `profiles.role = 'accountant'`. It passed, and it proved almost nothing: it started Z as a
-- zzper and never let Z do the one thing Z can actually do, which is write their own role column.
-- That gap is the reason the adversarial block below exists, and it is the most important block
-- in this file.
--
-- Every assertion is an ATTEMPT, from an impersonated session under SET ROLE authenticated (or
-- anon), with RLS on. Setup and read-back run as the owner, which RLS never applies to.
--
-- THREE THINGS THE FIXTURE MUST GET RIGHT, or this file proves nothing:
--
--   1. profiles is WRITABLE by its owner here, exactly as in production (profiles_update_own, no
--      column restriction, UPDATE granted on every column including `role`). A fixture where Z
--      cannot write their own role would make the bypass untestable and this file green for a
--      reason production does not have. That is the failure this file was rewritten to fix.
--   2. accountant_clients carries RLS with a SELECT and a DELETE policy and NOTHING ELSE. The
--      absence of an INSERT policy is not decoration — it IS the boundary the new write rule
--      leans on. A fixture that leaves the table open would let Z manufacture their own evidence.
--   3. accountant_directory is created by the migration, i.e. AFTER fixture.sql hands out its
--      table grants, so it needs an explicit grant here. Without one every write fails for lack
--      of privilege rather than for lack of a policy — which looks identical and means something
--      else entirely.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;

-- (1) profiles as production has it: RLS on, own row readable AND OWN ROW WRITABLE.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated USING (id = (select auth.uid()));
-- Reproduced deliberately, including the absence of any column restriction on `role`. This is the
-- policy that makes the self-declaration self-writable, and the whole point of the adversarial
-- block is to run against it rather than around it.
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = (select auth.uid())) WITH CHECK (id = (select auth.uid()));

-- (2) accountant_clients as production has it: SELECT and DELETE, and NO insert or update policy.
ALTER TABLE public.accountant_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accountant_clients_select ON public.accountant_clients;
CREATE POLICY accountant_clients_select ON public.accountant_clients
  FOR SELECT TO authenticated
  USING (accountant_id = (select auth.uid()) OR zzper_id = (select auth.uid()));
DROP POLICY IF EXISTS accountant_clients_delete ON public.accountant_clients;
CREATE POLICY accountant_clients_delete ON public.accountant_clients
  FOR DELETE TO authenticated
  USING (accountant_id = (select auth.uid()) OR zzper_id = (select auth.uid()));

-- (3) the grants the real Data API has.
GRANT USAGE ON SCHEMA public, auth TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accountant_directory TO authenticated;
GRANT SELECT ON public.accountant_directory TO anon;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accountant_clients TO authenticated;

-- ── The world ────────────────────────────────────────────────────────────────────────────────
INSERT INTO public.profiles (id, role) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'accountant'),   -- A, a real office
  ('b0000000-0000-0000-0000-00000000000b', 'accountant'),   -- B, a real office
  ('20000000-0000-0000-0000-000000000002', 'zzper'),        -- Z, an ordinary owner
  ('c0000000-0000-0000-0000-00000000000c', 'zzper');        -- C, a client of A and B

-- THE EVIDENCE. A and B each hold a consented link; Z holds none. In production this row can only
-- be written by /api/invite/accept on service_role, and only after the accepting user's e-mail is
-- verified against the invitation — which is exactly why it is worth more than a role column.
INSERT INTO public.accountant_clients (accountant_id, zzper_id) VALUES
  ('a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000c'),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-00000000000c');

SET ROLE authenticated;

-- =============================================================================================
-- THE BYPASS, END TO END. This is the block the previous version of this file was missing.
-- =============================================================================================

SELECT set_config('test.uid', '20000000-0000-0000-0000-000000000002', false);

-- 1. Z cannot publish a listing outright.
DO $$ BEGIN
  INSERT INTO public.accountant_directory (accountant_id, office_name, city, contact_email, languages, published)
  VALUES ('20000000-0000-0000-0000-000000000002', 'Niet Een Kantoor', 'Utrecht', 'z@z.nl', ARRAY['nl'], true);
  RAISE EXCEPTION '[KANTOORGIDS-BEWIJS] an ondernemer PUBLISHED a listing outright — the hole is open';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '   ok · a listing cannot be born published without evidence (42501)';
END $$;

-- 2. Z CAN write a draft. Deliberate, and stated as an assertion rather than left to chance: an
--    unpublished row is readable by nobody but its owner, and gating this would stop a new office
--    from preparing its listing before its first client lands.
DO $$ BEGIN
  INSERT INTO public.accountant_directory (accountant_id, office_name, city, contact_email, languages, published)
  VALUES ('20000000-0000-0000-0000-000000000002', 'Concept', 'Utrecht', 'z@z.nl', ARRAY['nl'], false);
  RAISE NOTICE '   ok · a draft is free to write — it is public to no one';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION '[KANTOORGIDS-BEWIJS] a draft was refused — a new office cannot prepare a listing';
END $$;

-- 3. THE SELF-PROMOTION. Z writes their own profiles.role, which production genuinely permits:
--    profiles_update_own has no column restriction and UPDATE is granted on `role`. This must
--    SUCCEED — if it fails, the rest of this block proves nothing about the real database.
DO $$
DECLARE n int; r text;
BEGIN
  UPDATE public.profiles SET role = 'accountant'
   WHERE id = '20000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION '[KANTOORGIDS-BEWIJS] Z could not write their own role (% rows) — the fixture no longer reproduces production, and the bypass below is untested', n;
  END IF;
  SELECT role INTO r FROM public.profiles WHERE id = '20000000-0000-0000-0000-000000000002';
  IF r <> 'accountant' THEN
    RAISE EXCEPTION '[KANTOORGIDS-BEWIJS] the self-promotion did not land (role = %)', r;
  END IF;
  RAISE NOTICE '   ok · Z really can self-promote profiles.role — which is why it is not the boundary';
END $$;

-- 4. …and it buys nothing. Z now SAYS accountant and still holds no consented client link, so the
--    publish is refused exactly as before. This is the assertion the whole batch turns on.
DO $$ BEGIN
  UPDATE public.accountant_directory SET published = true
   WHERE accountant_id = '20000000-0000-0000-0000-000000000002';
  RAISE EXCEPTION '[KANTOORGIDS-BEWIJS] SELF-PROMOTION BYPASS: Z set their own role and published a public listing';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '   ok · self-promoting the role buys nothing — publishing still refused (42501)';
END $$;

-- 5. …and neither does inserting a fresh published row after the promotion.
DO $$ BEGIN
  DELETE FROM public.accountant_directory WHERE accountant_id = '20000000-0000-0000-0000-000000000002';
  INSERT INTO public.accountant_directory (accountant_id, office_name, city, contact_email, languages, published)
  VALUES ('20000000-0000-0000-0000-000000000002', 'Toch Een Kantoor', 'Utrecht', 'z@z.nl', ARRAY['nl'], true);
  RAISE EXCEPTION '[KANTOORGIDS-BEWIJS] SELF-PROMOTION BYPASS: a promoted Z inserted a published listing';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '   ok · …and cannot insert a published row either';
END $$;

-- 6. The last door: Z tries to manufacture the evidence itself. accountant_clients has no INSERT
--    policy, so this is refused — and that refusal is what the write boundary above is standing on.
DO $$ BEGIN
  INSERT INTO public.accountant_clients (accountant_id, zzper_id)
  VALUES ('20000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000c');
  RAISE EXCEPTION '[KANTOORGIDS-BEWIJS] SELF-LINK: Z manufactured their own evidence';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '   ok · Z cannot manufacture the evidence — accountant_clients takes no session write';
END $$;

-- Put Z back to what they are, so the remaining blocks read against a clean world.
RESET ROLE;
UPDATE public.profiles SET role = 'zzper' WHERE id = '20000000-0000-0000-0000-000000000002';
DELETE FROM public.accountant_directory WHERE accountant_id = '20000000-0000-0000-0000-000000000002';
SET ROLE authenticated;

-- =============================================================================================
-- Nobody is trapped: a row stays correctable and removable by its owner
-- =============================================================================================
RESET ROLE;
INSERT INTO public.accountant_directory (accountant_id, office_name, city, contact_email, languages, published)
VALUES ('20000000-0000-0000-0000-000000000002', 'Ooit Een Kantoor', 'Utrecht', 'z@z.nl', ARRAY['nl'], true);
SET ROLE authenticated;
SELECT set_config('test.uid', '20000000-0000-0000-0000-000000000002', false);

-- An office that has lost its last client (or never had one) keeps every way OUT.
DO $$
DECLARE n int;
BEGIN
  UPDATE public.accountant_directory SET published = false
   WHERE accountant_id = '20000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '[KANTOORGIDS-BEWIJS] TRAPPED — cannot unpublish without evidence (% rows)', n; END IF;
  RAISE NOTICE '   ok · unpublishing is never blocked, evidence or not';
END $$;

DO $$
DECLARE n int;
BEGIN
  UPDATE public.accountant_directory SET city = 'Amersfoort'
   WHERE accountant_id = '20000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '[KANTOORGIDS-BEWIJS] an unpublished row is not correctable by its owner (% rows)', n; END IF;
  RAISE NOTICE '   ok · an unpublished row stays correctable by its owner';
END $$;

DO $$
DECLARE n int;
BEGIN
  DELETE FROM public.accountant_directory WHERE accountant_id = '20000000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '[KANTOORGIDS-BEWIJS] an own listing cannot be removed (% rows)', n; END IF;
  RAISE NOTICE '   ok · an own listing can always be removed';
END $$;

-- =============================================================================================
-- The positive controls: a real office still works
-- =============================================================================================

-- A holds a consented link, so A publishes. This is also the file's control: a broken harness
-- would fail here first rather than passing everything above for the wrong reason.
SELECT set_config('test.uid', 'a0000000-0000-0000-0000-00000000000a', false);
DO $$ BEGIN
  INSERT INTO public.accountant_directory (accountant_id, office_name, city, contact_email, languages, published)
  VALUES ('a0000000-0000-0000-0000-00000000000a', 'Kantoor A', 'Utrecht', 'a@a.nl', ARRAY['nl','ar'], true);
  RAISE NOTICE '   ok · an office with a consented client link publishes a complete listing';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE EXCEPTION '[KANTOORGIDS-BEWIJS] the guard refuses a real office — the control failed';
END $$;

-- THE RACE. The route reads eligibility before it writes, and those are two statements: either
-- party may unlink in between. So the question is not whether the preflight was right when it ran,
-- but whether the DATABASE still refuses once the evidence is gone — because a listing that stays
-- public after its last client left is exactly what the preflight cannot prevent and this policy
-- must. A's link is removed here with A's own session (accountant_clients_delete permits it), which
-- is also the real way this happens.
DO $$
DECLARE n int;
BEGIN
  DELETE FROM public.accountant_clients
   WHERE accountant_id = 'a0000000-0000-0000-0000-00000000000a';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '[KANTOORGIDS-BEWIJS] could not remove the link to set up the race (% rows)', n; END IF;
END $$;

DO $$ BEGIN
  UPDATE public.accountant_directory SET city = 'Amersfoort', published = true
   WHERE accountant_id = 'a0000000-0000-0000-0000-00000000000a';
  RAISE EXCEPTION '[KANTOORGIDS-BEWIJS] RACE: publication survived the evidence disappearing';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '   ok · the database still refuses once the link is gone (42501) — the preflight is advisory, this is not';
END $$;

-- …and the office is still not trapped by that refusal: it can take the listing down.
DO $$
DECLARE n int;
BEGIN
  UPDATE public.accountant_directory SET published = false
   WHERE accountant_id = 'a0000000-0000-0000-0000-00000000000a';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '[KANTOORGIDS-BEWIJS] an office that lost its last client is trapped (% rows)', n; END IF;
  RAISE NOTICE '   ok · …and can still take its own listing down afterwards';
END $$;

-- Put A's evidence back so the rest of the file reads against the world it describes.
RESET ROLE;
INSERT INTO public.accountant_clients (accountant_id, zzper_id)
VALUES ('a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000c');
UPDATE public.accountant_directory SET published = true
 WHERE accountant_id = 'a0000000-0000-0000-0000-00000000000a';
SET ROLE authenticated;
SELECT set_config('test.uid', 'a0000000-0000-0000-0000-00000000000a', false);

-- A cannot write B's row. USING pins the row to its owner, so the update matches NOTHING rather
-- than raising: a refusal by invisibility, which is the right shape for a row that is not yours.
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
  IF n <> 0 THEN RAISE EXCEPTION '[KANTOORGIDS-BEWIJS] office A wrote office B''s listing (% rows)', n; END IF;
  BEGIN
    INSERT INTO public.accountant_directory (accountant_id, office_name, city, contact_email, languages)
    VALUES ('b0000000-0000-0000-0000-00000000000b', 'Gekaapt', 'Zwolle', 'x@x.nl', ARRAY['nl']);
    RAISE EXCEPTION '[KANTOORGIDS-BEWIJS] office A INSERTED a listing owned by B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE '   ok · one office cannot write another''s listing, in either direction';
END $$;

-- =============================================================================================
-- [KANTOORGIDS-TAAL] The language contract, unchanged by this repair
-- =============================================================================================

-- Publishing with no language is refused — the defect this batch began with. The route used to
-- send exactly this row, and the 23514 arrived at the office as a bare 503.
SELECT set_config('test.uid', 'a0000000-0000-0000-0000-00000000000a', false);
DO $$ BEGIN
  UPDATE public.accountant_directory SET languages = ARRAY[]::text[]
   WHERE accountant_id = 'a0000000-0000-0000-0000-00000000000a';
  RAISE EXCEPTION '[KANTOORGIDS-TAAL] a PUBLISHED listing was left with no language';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE '   ok · a published listing cannot be stripped of its last language (23514)';
END $$;

-- A DRAFT with no language is fine — accountant_directory_published_has_language is gated on
-- `published`. As B, on B's own row: every write is pinned to its owner.
SELECT set_config('test.uid', 'b0000000-0000-0000-0000-00000000000b', false);
DO $$ BEGIN
  UPDATE public.accountant_directory SET languages = ARRAY[]::text[], published = false
   WHERE accountant_id = 'b0000000-0000-0000-0000-00000000000b';
  RAISE NOTICE '   ok · a draft may name no language';
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION '[KANTOORGIDS-TAAL] a draft was refused for having no language';
END $$;

-- An unknown code is refused in a DRAFT too, because accountant_directory_languages_known is not
-- conditional on `published`. This is why the route validates languages on every write.
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

-- Anonymous sees published rows and nothing else. B's row is a draft now, so it must be invisible
-- — not redacted, absent.
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

DO $$ BEGIN
  INSERT INTO public.accountant_directory (accountant_id, office_name, city, contact_email, languages)
  VALUES ('a0000000-0000-0000-0000-00000000000a', 'anon', 'x', 'x@x.nl', ARRAY['nl']);
  RAISE EXCEPTION '[KANTOORGIDS] anon INSERTED into the directory';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE '   ok · anon cannot write the directory';
END $$;

RESET ROLE;
SELECT '[KANTOORGIDS-BEWIJS] held: a listing goes public only on a consented client link, self-promoting profiles.role buys nothing, the evidence itself cannot be forged, nobody is trapped, and the read side is unchanged' AS result;
