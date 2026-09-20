-- tests/sql/privilege-check.sql
-- [PRIVILEGE-REGISTRY] After a test's migrations ran, ask the CATALOG who can execute what, and
-- compare with the registry's intent (loaded by privilege-intent.sql into privilege_intent).
--
-- Runs between the migrations and the test file, so the only functions in `public` are the ones
-- the migrations created — the test's own helpers (t_eq, t_is, …) are not there yet.
--
-- THREE RULES
--   1. Every function in public must have a registry row. An unregistered function fails the run:
--      that is exactly the shape of the two refund writers that were only in production.
--   2. A role's effective EXECUTE is compared with the intent only when the intent is ALLOW or
--      DENY. UNKNOWN is printed with the actual value and decides nothing.
--   3. The comparison is HARD only when every repo migration that shapes this function's ACL
--      (acl_files, derived from the GRANT/REVOKE statements on disk) was loaded by this test.
--      Otherwise the row is reported as PARTIAL: the test replays part of the function's history,
--      and a mismatch there would blame the wrong file. `seam.loaded` carries the loaded list.
--
-- The check reads has_function_privilege. It never reads the migration text.

\set ON_ERROR_STOP on
SELECT set_config('seam.loaded', :'loaded', false);

DO $$
DECLARE
  loaded    text[] := string_to_array(current_setting('seam.loaded'), ' ');
  r         record;
  failures  text[] := ARRAY[]::text[];
  hard      int := 0;
  partial   int := 0;
  unknowns  int := 0;
  deviated  int := 0;
  complete  boolean;
  labels    text[];
  intents   text[];
  actuals   boolean[];
  devs      text[];
  i         int;
BEGIN
  FOR r IN
    SELECT format('public.%I(%s)', p.proname, oidvectortypes(p.proargtypes)) AS sig,
           p.oid, p.prosecdef,
           has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_x,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_x,
           has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role_x,
           (p.proacl IS NULL OR EXISTS (
              SELECT 1 FROM aclexplode(p.proacl) e WHERE e.grantee = 0 AND e.privilege_type = 'EXECUTE')) AS public_x,
           i.kind, i.definer, i.acl_files,
           i.i_anon, i.i_authenticated, i.i_service_role, i.i_public,
           i.dev_anon, i.dev_authenticated, i.dev_service_role, i.dev_public
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      LEFT JOIN privilege_intent i ON i.sig = format('public.%I(%s)', p.proname, oidvectortypes(p.proargtypes))
     WHERE n.nspname = 'public'
     ORDER BY 1
  LOOP
    IF r.kind IS NULL THEN
      failures := failures || format('%s: created by these migrations but has NO registry row (scripts/privilege-registry.ts)', r.sig);
      CONTINUE;
    END IF;

    IF r.prosecdef IS DISTINCT FROM r.definer THEN
      failures := failures || format('%s: registry says definer=%s, catalog says %s', r.sig, r.definer, r.prosecdef);
    END IF;

    complete := (r.acl_files <@ loaded);
    IF complete THEN hard := hard + 1; ELSE partial := partial + 1; END IF;

    labels  := ARRAY['anon', 'authenticated', 'service_role', 'PUBLIC'];
    intents := ARRAY[r.i_anon, r.i_authenticated, r.i_service_role, r.i_public];
    actuals := ARRAY[r.anon_x, r.authenticated_x, r.service_role_x, r.public_x];
    devs    := ARRAY[r.dev_anon, r.dev_authenticated, r.dev_service_role, r.dev_public];

    FOR i IN 1..4 LOOP
      IF intents[i] = 'UNKNOWN' THEN
        unknowns := unknowns + 1;
        RAISE NOTICE '  ? % %: UNKNOWN (actual %)', r.sig, labels[i], actuals[i];
      ELSIF (intents[i] = 'ALLOW') = actuals[i] THEN
        NULL;
      ELSIF NOT complete THEN
        RAISE NOTICE '  ~ % %: intent % but actual % — PARTIAL replay, not judged', r.sig, labels[i], intents[i], actuals[i];
      ELSIF devs[i] IS NOT NULL THEN
        deviated := deviated + 1;
        RAISE NOTICE '  ! % %: intent % but actual % — ACCEPTED DEVIATION: %', r.sig, labels[i], intents[i], actuals[i], devs[i];
      ELSE
        failures := failures || format('%s %s: intent %s, actual %s', r.sig, labels[i], intents[i], actuals[i]);
      END IF;
    END LOOP;

    IF NOT complete THEN
      RAISE NOTICE '  ~ %: partial replay — not loaded: %', r.sig,
        array_to_string(ARRAY(SELECT unnest(r.acl_files) EXCEPT SELECT unnest(loaded)), ', ');
    END IF;
  END LOOP;

  RAISE NOTICE '[PRIVILEGE-SEAM] % function(s) judged against intent, % partial replay, % UNKNOWN reported, % accepted deviation(s)',
    hard, partial, unknowns, deviated;

  IF array_length(failures, 1) > 0 THEN
    RAISE EXCEPTION E'[PRIVILEGE-SEAM] effective privileges differ from registry intent:\n  %',
      array_to_string(failures, E'\n  ');
  END IF;
END $$;
