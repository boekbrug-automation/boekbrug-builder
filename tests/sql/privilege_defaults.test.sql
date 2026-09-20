-- migrations: fair_use_usage.sql, ontvangen_fair_use_per_document.sql, rpc_anon_revoke.sql
-- =====================================================================
-- [PRIVILEGE-REGISTRY] The seam reproduces Supabase's default grants, and a REVOKE FROM PUBLIC
-- alone does not close a function — proven against a real PostgreSQL.
-- Run: npm run test:sql
-- =====================================================================
-- ── WHY THIS ONE ──
--
-- The two refund writers were revoked FROM PUBLIC by their migration and stayed open to anon,
-- because Supabase attaches a NAMED grant to anon, authenticated and service_role on every new
-- function. This file pins the mechanism the whole privilege programme rests on:
--
--   1. a function created here, with no GRANT at all, is executable by all three roles AND PUBLIC
--      (the fixture's ALTER DEFAULT PRIVILEGES is doing what production's does);
--   2. REVOKE … FROM PUBLIC removes only the PUBLIC entry — anon keeps EXECUTE;
--   3. naming the four paths closes it;
--   4. a trigger fires for a role that has no EXECUTE on its function (so trigger functions need
--      no grant, which is why their registry intent is DENY/DENY/UNKNOWN);
--   5. and the four fair-use functions this test's migrations created were judged against the
--      registry by privilege-check.sql BEFORE this file ran — a HARD comparison, because every
--      migration that shapes their ACL is in the header above (rpc_anon_revoke.sql included:
--      fair_use_consume is closed to anon by that file, not by the one that creates it).
--
-- Everything is asked of the catalog with has_function_privilege. Nothing here reads SQL text.
-- =====================================================================

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.t_priv(what text, got boolean, want boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL · % — got %, expected %', what, got, want;
  END IF;
  RAISE NOTICE '  ok · % (%)', what, got;
END $$;

-- 1. Under the reproduced defaults a bare new function is open to everyone.
CREATE FUNCTION public.seam_probe_open() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'select 1';
SELECT t_priv('defaults: anon may execute a bare new function',          has_function_privilege('anon',          'public.seam_probe_open()', 'EXECUTE'), true);
SELECT t_priv('defaults: authenticated may execute a bare new function', has_function_privilege('authenticated', 'public.seam_probe_open()', 'EXECUTE'), true);
SELECT t_priv('defaults: service_role may execute a bare new function',  has_function_privilege('service_role',  'public.seam_probe_open()', 'EXECUTE'), true);

-- 2. The incident shape: REVOKE FROM PUBLIC alone leaves anon standing.
REVOKE ALL ON FUNCTION public.seam_probe_open() FROM PUBLIC;
SELECT t_priv('after REVOKE FROM PUBLIC only: anon STILL executes (the refund-writer shape)',
              has_function_privilege('anon', 'public.seam_probe_open()', 'EXECUTE'), true);
SELECT t_priv('after REVOKE FROM PUBLIC only: no PUBLIC entry remains',
              EXISTS (SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid = 'public.seam_probe_open()'::regprocedure)) e WHERE e.grantee = 0), false);

-- 3. Naming all four paths closes it; an explicit GRANT re-opens exactly one role.
REVOKE ALL ON FUNCTION public.seam_probe_open() FROM PUBLIC, anon, authenticated, service_role;
SELECT t_priv('four paths named: anon closed',          has_function_privilege('anon',          'public.seam_probe_open()', 'EXECUTE'), false);
SELECT t_priv('four paths named: authenticated closed', has_function_privilege('authenticated', 'public.seam_probe_open()', 'EXECUTE'), false);
SELECT t_priv('four paths named: service_role closed',  has_function_privilege('service_role',  'public.seam_probe_open()', 'EXECUTE'), false);
GRANT EXECUTE ON FUNCTION public.seam_probe_open() TO service_role;
SELECT t_priv('explicit grant: service_role only', has_function_privilege('service_role', 'public.seam_probe_open()', 'EXECUTE'), true);
SELECT t_priv('explicit grant: anon still closed',  has_function_privilege('anon',         'public.seam_probe_open()', 'EXECUTE'), false);

-- 4. A trigger fires for a role that may not execute its function.
CREATE TABLE public.seam_trigger_target (id int);
CREATE FUNCTION public.seam_probe_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
REVOKE ALL ON FUNCTION public.seam_probe_trigger() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER seam_probe_trg BEFORE INSERT ON public.seam_trigger_target FOR EACH ROW EXECUTE FUNCTION public.seam_probe_trigger();
GRANT INSERT, SELECT ON public.seam_trigger_target TO authenticated;
SET ROLE authenticated;
INSERT INTO public.seam_trigger_target VALUES (1);
RESET ROLE;
SELECT t_priv('trigger fired for authenticated without EXECUTE on its function',
              (SELECT count(*) = 1 FROM public.seam_trigger_target), true);
SELECT t_priv('…and authenticated indeed has no EXECUTE on it',
              has_function_privilege('authenticated', 'public.seam_probe_trigger()', 'EXECUTE'), false);

-- 5. The fair-use functions, as the migrations in the header left them: what the registry intends.
--    fair_use_consume's creating file revokes only PUBLIC; anon and authenticated are closed by
--    rpc_anon_revoke.sql afterwards. The per-document pair names all four paths in one file.
SELECT t_priv('fair_use_consume: anon closed (by rpc_anon_revoke.sql, not by its creator)',
              has_function_privilege('anon',          'public.fair_use_consume(uuid, text, text, integer, integer)', 'EXECUTE'), false);
SELECT t_priv('fair_use_consume: authenticated closed',
              has_function_privilege('authenticated', 'public.fair_use_consume(uuid, text, text, integer, integer)', 'EXECUTE'), false);
SELECT t_priv('fair_use_consume: service_role open',
              has_function_privilege('service_role',  'public.fair_use_consume(uuid, text, text, integer, integer)', 'EXECUTE'), true);
SELECT t_priv('fair_use_consume_for_document: anon closed',
              has_function_privilege('anon',          'public.fair_use_consume_for_document(uuid, uuid, text, integer)', 'EXECUTE'), false);
SELECT t_priv('fair_use_release_for_document: authenticated closed',
              has_function_privilege('authenticated', 'public.fair_use_release_for_document(uuid, uuid)', 'EXECUTE'), false);
SELECT t_priv('fair_use_release_for_document: service_role open',
              has_function_privilege('service_role',  'public.fair_use_release_for_document(uuid, uuid)', 'EXECUTE'), true);

DROP TABLE public.seam_trigger_target;
DROP FUNCTION public.seam_probe_trigger();
DROP FUNCTION public.seam_probe_open();
