-- docs/PRIVILEGE_ORACLE.sql
-- [PRIVILEGE-REGISTRY] GENERATED from scripts/privilege-registry.ts — do not edit by hand.
-- Regenerate with:  npx tsx scripts/privilege-oracle.ts --write
--
-- READ ONLY. Every block below is a SELECT over the catalog. Nothing here grants, revokes, alters
-- or writes. Run each numbered block on its own in the Supabase SQL editor (or through a
-- read-only tool) and read the verdict column.
--
-- WHY THE CATALOG AND NOT THE MIGRATION FILE. A migration that revoked PUBLIC still left anon with
-- EXECUTE on two money-writing functions, because Supabase grants anon by NAME on every new
-- function and a REVOKE FROM PUBLIC does not touch a named grantee. Two of those functions existed
-- only in production's migration history, never in this repository. The file cannot answer "who
-- can call this today?". has_function_privilege can.
--
-- WHAT THE VERDICTS MEAN
--   ok                      effective privilege equals the registry intent
--   UNKNOWN(t|f)            the registry has no decision yet; the actual value is shown, nothing passes or fails
--   ACCEPTED_DEVIATION      reality differs from intent, and the registry records why it is left for now
--   DRIFT                   reality differs from intent and nothing in the registry accounts for it → act
--   MISSING                 the registry names a live function the catalog does not have
--   UNREGISTERED            a postgres-owned function in public with no registry row
-- The acl_md5 column is forensic only: it changes when ACL entries are reordered, which is not a
-- privilege change. Never read it as pass or fail.
--
-- Registry at generation time: 52 live functions, 40 UNKNOWN decisions, 22 accepted deviations.

-- ═══ 1. PER FUNCTION: registry intent ↔ effective privileges ═══════════════════════════════════

WITH intent(sig, kind, status, definer, i_anon, i_authenticated, i_service_role, i_public, dev_anon, dev_authenticated, dev_service_role, dev_public, acl_files) AS (VALUES
  ('public.allocate_bank_payment(uuid, uuid, uuid, numeric, date)', 'client_rpc', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.apply_bank_payment(uuid, uuid, uuid, numeric, date)', 'client_rpc', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.apply_manual_payment(uuid, uuid, numeric, date, text, text[], uuid)', 'client_rpc', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.book_bank_batch(uuid, uuid, uuid[], date)', 'client_rpc', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.confirm_bank_payment(uuid, uuid, uuid, date)', 'client_rpc', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.move_invoice_payment(uuid, uuid, uuid)', 'client_rpc', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.next_invoice_seq(uuid, integer, text)', 'client_rpc', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.is_my_accountant_client(uuid)', 'rls_helper', 'live', true, 'ALLOW', 'ALLOW', 'ALLOW', 'UNKNOWN', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.acting_for_owner()', 'rls_helper', 'live', true, 'UNKNOWN', 'ALLOW', 'ALLOW', 'UNKNOWN', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.audit_row_is_about_me(text, uuid, uuid)', 'rls_helper', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.has_active_confirm_mandate(uuid, uuid)', 'rls_helper', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.has_active_invoice_mandate(uuid, uuid)', 'rls_helper', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.ai_budget_consume(bigint, bigint)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.ai_budget_settle(bigint)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.check_rate_limit(uuid, text, integer, integer)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.check_rate_limit_key(text, text, integer, integer)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.fair_use_consume(uuid, text, text, integer, integer)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.fair_use_consume_for_document(uuid, uuid, text, integer)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.fair_use_release(uuid, text, text, integer)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.fair_use_release_for_document(uuid, uuid)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.invoice_number_twins(uuid, uuid)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.recompute_invoice_amount_paid(uuid, uuid)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.seed_invoice_counter(uuid, integer, text, integer)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.vault_delete_secret(uuid)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.vault_read_secret(uuid)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.vault_update_or_create_secret(uuid, text, text)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.work_done_counts(uuid, date, date)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.cleanup_old_rate_limits()', 'internal', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.assert_credit_within_original()', 'trigger', 'live', true, 'DENY', 'DENY', 'UNKNOWN', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.assert_credit_within_rate()', 'trigger', 'live', true, 'DENY', 'DENY', 'UNKNOWN', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.handle_new_user()', 'trigger', 'live', true, 'DENY', 'DENY', 'UNKNOWN', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.prevent_verwerkt_invoice_changes()', 'trigger', 'live', true, 'DENY', 'DENY', 'UNKNOWN', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.accountant_status_door_only()', 'trigger', 'live', true, 'DENY', 'DENY', 'UNKNOWN', 'UNKNOWN', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', NULL, NULL, ARRAY[]::text[]),
  ('public.grant_welcome_plus()', 'trigger', 'live', true, 'DENY', 'DENY', 'UNKNOWN', 'UNKNOWN', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', NULL, NULL, ARRAY[]::text[]),
  ('public.reverse_invoice_payment(uuid, uuid)', 'server_rpc', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.answer_mollie_refund(uuid, text, text, numeric)', 'server_rpc', 'live', true, 'DENY', 'UNKNOWN', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.search_clients_fuzzy(text)', 'invoker_rpc', 'live', false, 'DENY', 'ALLOW', 'ALLOW', 'UNKNOWN', 'PUBLIC default entry never revoked; later hardening, not this PR', NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.search_documents_fuzzy(text)', 'invoker_rpc', 'live', false, 'DENY', 'ALLOW', 'ALLOW', 'UNKNOWN', 'PUBLIC default entry never revoked; later hardening, not this PR', NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.search_folders_fuzzy(text)', 'invoker_rpc', 'live', false, 'DENY', 'ALLOW', 'ALLOW', 'UNKNOWN', 'PUBLIC default entry never revoked; later hardening, not this PR', NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.search_invoices_fuzzy(text)', 'invoker_rpc', 'live', false, 'DENY', 'ALLOW', 'ALLOW', 'UNKNOWN', 'PUBLIC default entry never revoked; later hardening, not this PR', NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.mollie_refund_reason_of(text)', 'internal', 'live', false, 'DENY', 'DENY', 'ALLOW', 'DENY', 'original migration intended service_role only; anon/authenticated kept by the default grant; no change in this PR', 'original migration intended service_role only; no change in this PR', NULL, NULL, ARRAY[]::text[]),
  ('public.get_accountant_for_zzper(uuid)', 'invoker_rpc', 'live', false, 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.assert_paid_is_backed()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'UNKNOWN', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', NULL, NULL, ARRAY[]::text[]),
  ('public.documents_search_vector_update()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'UNKNOWN', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', NULL, NULL, ARRAY[]::text[]),
  ('public.prevent_billing_self_grant()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'UNKNOWN', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', NULL, NULL, ARRAY[]::text[]),
  ('public.prevent_paid_invoice_rewrite()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'UNKNOWN', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', NULL, NULL, ARRAY[]::text[]),
  ('public.set_updated_at()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'UNKNOWN', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', NULL, NULL, ARRAY[]::text[]),
  ('public.touch_updated_at()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'UNKNOWN', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', NULL, NULL, ARRAY[]::text[]),
  ('public.assert_bookkeeping_date_sane()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.guard_paid_when_verwerkt()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.invoices_search_vector_update()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.prevent_accountant_amount_changes()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[])
),
live AS (
  SELECT format('public.%I(%s)', p.proname, oidvectortypes(p.proargtypes)) AS sig,
         p.oid,
         pg_get_userbyid(p.proowner)                              AS owner,
         p.prosecdef                                              AS definer,
         has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_x,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_x,
         has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role_x,
         (p.proacl IS NULL OR EXISTS (
            SELECT 1 FROM aclexplode(p.proacl) e WHERE e.grantee = 0 AND e.privilege_type = 'EXECUTE'))
                                                                  AS public_x,
         md5(coalesce(p.proacl::text, '<null>'))                  AS acl_md5
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
),
joined AS (
  SELECT coalesce(i.sig, l.sig) AS sig, i.kind, i.definer AS i_definer,
         i.i_anon, i.i_authenticated, i.i_service_role, i.i_public,
         i.dev_anon, i.dev_authenticated, i.dev_service_role, i.dev_public,
         l.owner, l.definer AS l_definer, l.anon_x, l.authenticated_x, l.service_role_x, l.public_x, l.acl_md5,
         (i.sig IS NOT NULL) AS registered, (l.sig IS NOT NULL) AS present
    FROM intent i
    FULL OUTER JOIN live l ON l.sig = i.sig
   WHERE i.sig IS NOT NULL OR l.owner = 'postgres'
),
verdicts AS (
  SELECT sig, kind, registered, present, owner, l_definer, i_definer, acl_md5,
         anon_x, authenticated_x, service_role_x, public_x,
         CASE WHEN i_anon = 'UNKNOWN' THEN 'UNKNOWN(' || anon_x::text || ')'
              WHEN (i_anon = 'ALLOW') = anon_x THEN 'ok'
              WHEN dev_anon IS NOT NULL THEN 'ACCEPTED_DEVIATION' ELSE 'DRIFT' END AS v_anon,
         CASE WHEN i_authenticated = 'UNKNOWN' THEN 'UNKNOWN(' || authenticated_x::text || ')'
              WHEN (i_authenticated = 'ALLOW') = authenticated_x THEN 'ok'
              WHEN dev_authenticated IS NOT NULL THEN 'ACCEPTED_DEVIATION' ELSE 'DRIFT' END AS v_authenticated,
         CASE WHEN i_service_role = 'UNKNOWN' THEN 'UNKNOWN(' || service_role_x::text || ')'
              WHEN (i_service_role = 'ALLOW') = service_role_x THEN 'ok'
              WHEN dev_service_role IS NOT NULL THEN 'ACCEPTED_DEVIATION' ELSE 'DRIFT' END AS v_service_role,
         CASE WHEN i_public = 'UNKNOWN' THEN 'UNKNOWN(' || public_x::text || ')'
              WHEN (i_public = 'ALLOW') = public_x THEN 'ok'
              WHEN dev_public IS NOT NULL THEN 'ACCEPTED_DEVIATION' ELSE 'DRIFT' END AS v_public,
         CASE WHEN owner IS NULL THEN NULL WHEN owner = 'postgres' THEN 'ok' ELSE 'DRIFT(owner=' || owner || ')' END AS v_owner,
         CASE WHEN l_definer IS NULL OR i_definer IS NULL THEN NULL
              WHEN l_definer = i_definer THEN 'ok' ELSE 'DRIFT(definer=' || l_definer::text || ')' END AS v_definer
    FROM joined
)
SELECT sig,
       CASE WHEN NOT registered THEN 'UNREGISTERED'
            WHEN NOT present    THEN 'MISSING'
            WHEN 'DRIFT' IN (v_anon, v_authenticated, v_service_role, v_public)
              OR v_owner LIKE 'DRIFT%' OR v_definer LIKE 'DRIFT%' THEN 'DRIFT'
            WHEN 'ACCEPTED_DEVIATION' IN (v_anon, v_authenticated, v_service_role, v_public) THEN 'ACCEPTED_DEVIATION'
            WHEN v_anon LIKE 'UNKNOWN%' OR v_authenticated LIKE 'UNKNOWN%'
              OR v_service_role LIKE 'UNKNOWN%' OR v_public LIKE 'UNKNOWN%' THEN 'ok (with UNKNOWN)'
            ELSE 'ok' END AS verdict,
       kind, v_anon, v_authenticated, v_service_role, v_public, v_owner, v_definer,
       anon_x, authenticated_x, service_role_x, public_x, acl_md5 AS acl_md5_forensic_only
  FROM verdicts
 ORDER BY CASE WHEN NOT registered THEN 0 WHEN NOT present THEN 1 ELSE 2 END, sig;

-- ═══ 2. SET LEVEL: the things a per-function row cannot see ══════════════════════════════════════
-- One row per finding. An empty result is the pass. The last row is always a summary line, so an
-- empty result and a query that did not run are not the same thing.

WITH live AS (
  SELECT format('public.%I(%s)', p.proname, oidvectortypes(p.proargtypes)) AS sig,
         p.oid,
         pg_get_userbyid(p.proowner)                              AS owner,
         p.prosecdef                                              AS definer,
         has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_x,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_x,
         has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role_x,
         (p.proacl IS NULL OR EXISTS (
            SELECT 1 FROM aclexplode(p.proacl) e WHERE e.grantee = 0 AND e.privilege_type = 'EXECUTE'))
                                                                  AS public_x,
         md5(coalesce(p.proacl::text, '<null>'))                  AS acl_md5
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
),
registered(sig) AS (VALUES
  ('public.allocate_bank_payment(uuid, uuid, uuid, numeric, date)'),
  ('public.apply_bank_payment(uuid, uuid, uuid, numeric, date)'),
  ('public.apply_manual_payment(uuid, uuid, numeric, date, text, text[], uuid)'),
  ('public.book_bank_batch(uuid, uuid, uuid[], date)'),
  ('public.confirm_bank_payment(uuid, uuid, uuid, date)'),
  ('public.move_invoice_payment(uuid, uuid, uuid)'),
  ('public.next_invoice_seq(uuid, integer, text)'),
  ('public.is_my_accountant_client(uuid)'),
  ('public.acting_for_owner()'),
  ('public.audit_row_is_about_me(text, uuid, uuid)'),
  ('public.has_active_confirm_mandate(uuid, uuid)'),
  ('public.has_active_invoice_mandate(uuid, uuid)'),
  ('public.ai_budget_consume(bigint, bigint)'),
  ('public.ai_budget_settle(bigint)'),
  ('public.check_rate_limit(uuid, text, integer, integer)'),
  ('public.check_rate_limit_key(text, text, integer, integer)'),
  ('public.fair_use_consume(uuid, text, text, integer, integer)'),
  ('public.fair_use_consume_for_document(uuid, uuid, text, integer)'),
  ('public.fair_use_release(uuid, text, text, integer)'),
  ('public.fair_use_release_for_document(uuid, uuid)'),
  ('public.invoice_number_twins(uuid, uuid)'),
  ('public.recompute_invoice_amount_paid(uuid, uuid)'),
  ('public.seed_invoice_counter(uuid, integer, text, integer)'),
  ('public.vault_delete_secret(uuid)'),
  ('public.vault_read_secret(uuid)'),
  ('public.vault_update_or_create_secret(uuid, text, text)'),
  ('public.work_done_counts(uuid, date, date)'),
  ('public.cleanup_old_rate_limits()'),
  ('public.assert_credit_within_original()'),
  ('public.assert_credit_within_rate()'),
  ('public.handle_new_user()'),
  ('public.prevent_verwerkt_invoice_changes()'),
  ('public.accountant_status_door_only()'),
  ('public.grant_welcome_plus()'),
  ('public.reverse_invoice_payment(uuid, uuid)'),
  ('public.answer_mollie_refund(uuid, text, text, numeric)'),
  ('public.search_clients_fuzzy(text)'),
  ('public.search_documents_fuzzy(text)'),
  ('public.search_folders_fuzzy(text)'),
  ('public.search_invoices_fuzzy(text)'),
  ('public.mollie_refund_reason_of(text)'),
  ('public.get_accountant_for_zzper(uuid)'),
  ('public.assert_paid_is_backed()'),
  ('public.documents_search_vector_update()'),
  ('public.prevent_billing_self_grant()'),
  ('public.prevent_paid_invoice_rewrite()'),
  ('public.set_updated_at()'),
  ('public.touch_updated_at()'),
  ('public.assert_bookkeeping_date_sane()'),
  ('public.guard_paid_when_verwerkt()'),
  ('public.invoices_search_vector_update()'),
  ('public.prevent_accountant_amount_changes()')
),
platform_class(owner, extension) AS (VALUES
  ('supabase_admin', 'pg_trgm')
),
ext_member AS (
  SELECT d.objid AS oid, e.extname
    FROM pg_depend d
    JOIN pg_extension e ON e.oid = d.refobjid
   WHERE d.classid = 'pg_proc'::regclass AND d.deptype = 'e'
),
expected_default_acl(for_role, in_schema, entries) AS (VALUES
  ('postgres', 'public', ARRAY['anon=X/postgres','authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]),
  ('postgres', 'storage', ARRAY['anon=X/postgres','authenticated=X/postgres','postgres=X/postgres','service_role=X/postgres']::text[]),
  ('supabase_admin', 'extensions', ARRAY['postgres=X*/supabase_admin']::text[]),
  ('supabase_admin', 'graphql', ARRAY['anon=X/supabase_admin','authenticated=X/supabase_admin','postgres=X/supabase_admin','service_role=X/supabase_admin']::text[]),
  ('supabase_admin', 'graphql_public', ARRAY['anon=X/supabase_admin','authenticated=X/supabase_admin','postgres=X/supabase_admin','service_role=X/supabase_admin']::text[]),
  ('supabase_admin', 'public', ARRAY['anon=X/supabase_admin','authenticated=X/supabase_admin','postgres=X/supabase_admin','service_role=X/supabase_admin']::text[]),
  ('supabase_admin', 'realtime', ARRAY['dashboard_user=X/supabase_admin','postgres=X/supabase_admin']::text[]),
  ('supabase_auth_admin', 'auth', ARRAY['dashboard_user=X/supabase_auth_admin','postgres=X/supabase_auth_admin']::text[])
),
actual_default_acl AS (
  SELECT pg_get_userbyid(d.defaclrole)::text AS for_role, coalesce(n.nspname, '<global>') AS in_schema,
         (SELECT array_agg(x ORDER BY x) FROM unnest(d.defaclacl::text::text[]) AS x) AS entries
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
   WHERE d.defaclobjtype = 'f'
),
findings AS (
  -- 2a. a postgres-owned function in public with no registry row
  SELECT 'UNREGISTERED_FUNCTION' AS finding, l.sig AS subject,
         'owner=' || l.owner || ' definer=' || l.definer::text || ' anon=' || l.anon_x::text AS detail
    FROM live l LEFT JOIN registered r ON r.sig = l.sig
   WHERE l.owner = 'postgres' AND r.sig IS NULL
  UNION ALL
  -- 2b. a platform-owned function in public that no named extension installed
  SELECT 'UNEXPECTED_PLATFORM_FUNCTION', l.sig,
         'owner=' || l.owner || ' extension=' || coalesce(m.extname, '<none>')
    FROM live l
    LEFT JOIN ext_member m ON m.oid = l.oid
   WHERE l.owner <> 'postgres'
     AND NOT EXISTS (SELECT 1 FROM platform_class pc WHERE pc.owner = l.owner AND pc.extension = m.extname)
  UNION ALL
  -- 2c. a platform-managed function that is SECURITY DEFINER
  SELECT 'PLATFORM_FUNCTION_IS_DEFINER', l.sig, 'owner=' || l.owner
    FROM live l JOIN ext_member m ON m.oid = l.oid
    JOIN platform_class pc ON pc.owner = l.owner AND pc.extension = m.extname
   WHERE l.definer
  UNION ALL
  -- 2d. the function-type default ACL rows differ from the recorded shape (compared as sets)
  SELECT 'DEFAULT_ACL_DRIFT', coalesce(e.for_role, a.for_role) || ' / ' || coalesce(e.in_schema, a.in_schema),
         'expected=' || coalesce(e.entries::text, '<no row>') || ' actual=' || coalesce(a.entries::text, '<no row>')
    FROM expected_default_acl e
    FULL OUTER JOIN actual_default_acl a ON a.for_role = e.for_role AND a.in_schema = e.in_schema
   WHERE e.entries IS DISTINCT FROM a.entries
  UNION ALL
  -- 2e. the linter's rule 0028, computed here: a SECURITY DEFINER function anon can execute while
  --     the registry says DENY. Cross-check afterwards with the Supabase advisor: every function
  --     it names under 0028 must appear in block 1 with i_anon = ALLOW or UNKNOWN.
  SELECT 'ANON_EXECUTES_DEFINER_AGAINST_INTENT', l.sig,
         coalesce('accepted deviation: ' || deny.deviation, 'registry intent anon = DENY and NO deviation recorded → DRIFT')
    FROM live l
    JOIN (VALUES
      ('public.allocate_bank_payment(uuid, uuid, uuid, numeric, date)', NULL),
      ('public.apply_bank_payment(uuid, uuid, uuid, numeric, date)', NULL),
      ('public.apply_manual_payment(uuid, uuid, numeric, date, text, text[], uuid)', NULL),
      ('public.book_bank_batch(uuid, uuid, uuid[], date)', NULL),
      ('public.confirm_bank_payment(uuid, uuid, uuid, date)', NULL),
      ('public.move_invoice_payment(uuid, uuid, uuid)', NULL),
      ('public.next_invoice_seq(uuid, integer, text)', NULL),
      ('public.audit_row_is_about_me(text, uuid, uuid)', NULL),
      ('public.has_active_confirm_mandate(uuid, uuid)', NULL),
      ('public.has_active_invoice_mandate(uuid, uuid)', NULL),
      ('public.ai_budget_consume(bigint, bigint)', NULL),
      ('public.ai_budget_settle(bigint)', NULL),
      ('public.check_rate_limit(uuid, text, integer, integer)', NULL),
      ('public.check_rate_limit_key(text, text, integer, integer)', NULL),
      ('public.fair_use_consume(uuid, text, text, integer, integer)', NULL),
      ('public.fair_use_consume_for_document(uuid, uuid, text, integer)', NULL),
      ('public.fair_use_release(uuid, text, text, integer)', NULL),
      ('public.fair_use_release_for_document(uuid, uuid)', NULL),
      ('public.invoice_number_twins(uuid, uuid)', NULL),
      ('public.recompute_invoice_amount_paid(uuid, uuid)', NULL),
      ('public.seed_invoice_counter(uuid, integer, text, integer)', NULL),
      ('public.vault_delete_secret(uuid)', NULL),
      ('public.vault_read_secret(uuid)', NULL),
      ('public.vault_update_or_create_secret(uuid, text, text)', NULL),
      ('public.work_done_counts(uuid, date, date)', NULL),
      ('public.cleanup_old_rate_limits()', NULL),
      ('public.assert_credit_within_original()', NULL),
      ('public.assert_credit_within_rate()', NULL),
      ('public.handle_new_user()', NULL),
      ('public.prevent_verwerkt_invoice_changes()', NULL),
      ('public.accountant_status_door_only()', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)'),
      ('public.grant_welcome_plus()', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)'),
      ('public.reverse_invoice_payment(uuid, uuid)', NULL),
      ('public.answer_mollie_refund(uuid, text, text, numeric)', NULL),
      ('public.search_clients_fuzzy(text)', 'PUBLIC default entry never revoked; later hardening, not this PR'),
      ('public.search_documents_fuzzy(text)', 'PUBLIC default entry never revoked; later hardening, not this PR'),
      ('public.search_folders_fuzzy(text)', 'PUBLIC default entry never revoked; later hardening, not this PR'),
      ('public.search_invoices_fuzzy(text)', 'PUBLIC default entry never revoked; later hardening, not this PR'),
      ('public.mollie_refund_reason_of(text)', 'original migration intended service_role only; anon/authenticated kept by the default grant; no change in this PR'),
      ('public.assert_paid_is_backed()', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)'),
      ('public.documents_search_vector_update()', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)'),
      ('public.prevent_billing_self_grant()', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)'),
      ('public.prevent_paid_invoice_rewrite()', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)'),
      ('public.set_updated_at()', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)'),
      ('public.touch_updated_at()', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)'),
      ('public.assert_bookkeeping_date_sane()', NULL),
      ('public.guard_paid_when_verwerkt()', NULL),
      ('public.invoices_search_vector_update()', NULL),
      ('public.prevent_accountant_amount_changes()', NULL)
    ) AS deny(sig, deviation) ON deny.sig = l.sig
   WHERE l.definer AND l.anon_x
)
SELECT finding, subject, detail FROM findings
UNION ALL
SELECT 'SUMMARY', 'findings above: ' || count(*)::text,
       'live public functions: ' || (SELECT count(*) FROM live)::text ||
       ', postgres-owned: ' || (SELECT count(*) FROM live WHERE owner = 'postgres')::text ||
       ', platform: ' || (SELECT count(*) FROM live WHERE owner <> 'postgres')::text
  FROM findings
ORDER BY 1, 2;

-- ═══ 3. PROVENANCE: production migration history ↔ this repository ═══════════════════════════════
-- A production migration that carries function or privilege DDL must have a versioned source here,
-- or an explicit acknowledgement in scripts/privilege-registry.ts. Anything else is DRIFT: a
-- function that exists only because something was applied outside the review path.
--   REPO           a file with the same name exists in supabase/migrations
--   ACKNOWLEDGED   listed in ACKNOWLEDGED_PRODUCTION_MIGRATIONS; the functions it creates are checked
--                  against that acknowledgement (mismatch → ACKNOWLEDGED_BUT_DIFFERENT)
--   DRIFT          neither
-- Rows with no function or privilege DDL are listed as 'not privilege-relevant' for completeness.

WITH repo(name) AS (VALUES
  ('BRIDGE-D_soft_delete_test_pollution'),
  ('account_purpose_archief'),
  ('accountant_amount_guard_restore'),
  ('accountant_clients_insert_consent'),
  ('accountant_clients_update_consent'),
  ('accountant_confirm_mandate'),
  ('accountant_directory'),
  ('accountant_discount_guard'),
  ('accountant_guard_fixed_search_path'),
  ('accountant_invoice_mandate'),
  ('accountant_invoice_status_sync'),
  ('accountant_subject_status'),
  ('accountant_vat_deduction_guard'),
  ('accountant_write_guard_fix'),
  ('accountant_write_holes'),
  ('ai_budget_settle'),
  ('ai_spend_guard'),
  ('allocate_bank_payment'),
  ('anon_mandate_oracle_revoke'),
  ('anon_revoke_refund_writers'),
  ('articles'),
  ('assets'),
  ('audit_logs_client_read'),
  ('auto_boeken'),
  ('auto_incasso'),
  ('bank_auto_book_blocked'),
  ('bank_auto_match_reason'),
  ('bank_confirm_atomic'),
  ('bank_connections'),
  ('bank_connections_updated_at'),
  ('bank_identity'),
  ('bank_ignore_reason'),
  ('bank_ignore_reason_storno'),
  ('bank_match_rejections'),
  ('bank_rpc_never_payable_states'),
  ('bank_statement_periods'),
  ('bank_transactions_column_grant'),
  ('bank_tx_attachments'),
  ('bank_tx_counterpart_iban'),
  ('bank_tx_direct_debit'),
  ('bank_tx_invoices'),
  ('bank_tx_invoices_amount'),
  ('bank_tx_invoices_memory_index'),
  ('bank_tx_invoices_read_only_policy'),
  ('bank_tx_source_identity'),
  ('bank_tx_statement_link'),
  ('betaalverzoek'),
  ('billing_subscription'),
  ('book_bank_batch_atomic'),
  ('bookkeeping_date_sane'),
  ('btw_filings'),
  ('btw_filings_carried'),
  ('btw_filings_divergence'),
  ('cash_entry_soft_delete'),
  ('cash_ledger'),
  ('cash_settlement_invoice_link'),
  ('cash_settlement_per_instalment'),
  ('circle_integrity_and_indexes'),
  ('client_country'),
  ('client_extra_lines'),
  ('clients_default_hourly_rate'),
  ('clients_term_phone'),
  ('company_members_sales_role'),
  ('confirm_bank_payment_regrant'),
  ('creditnota_external_reference'),
  ('creditnota_one_per_original'),
  ('creditnota_partial'),
  ('creditnota_per_rate_ceiling'),
  ('crm_backbone'),
  ('cron_runs'),
  ('daily_turnover'),
  ('deletion_request_purge_warning'),
  ('documents_accountant_read_policy'),
  ('documents_content_hash_unique'),
  ('documents_shared_and_storage_policies'),
  ('drop_duplicate_indexes'),
  ('drop_supplier_rows_that_are_misreadings'),
  ('eft_settlements'),
  ('email_failed_attempts'),
  ('email_sender_rules'),
  ('email_skipped_attachments_owner_read'),
  ('factuur_b_numbering'),
  ('fair_use_usage'),
  ('feedback'),
  ('folders_accountant_read'),
  ('function_search_path'),
  ('intake_claims'),
  ('invitations_rls_scoped_read'),
  ('invoice_accountant_attribution'),
  ('invoice_accountant_status_vocabulary'),
  ('invoice_accountant_write_guard'),
  ('invoice_archive_reason'),
  ('invoice_bijlage'),
  ('invoice_corrected_at'),
  ('invoice_corrections'),
  ('invoice_corrections_claim'),
  ('invoice_discount'),
  ('invoice_line_discount'),
  ('invoice_line_unit'),
  ('invoice_lines_accountant_gate'),
  ('invoice_manual_payment_idempotency_scope'),
  ('invoice_manual_payments'),
  ('invoice_move_payment'),
  ('invoice_move_payment_creditnota_guard'),
  ('invoice_name_follows_taught_supplier'),
  ('invoice_number_twins'),
  ('invoice_paid_requires_allocation'),
  ('invoice_partial_payments'),
  ('invoice_payment_date_rederive'),
  ('invoice_questions'),
  ('invoice_reminders'),
  ('invoice_schedules'),
  ('invoice_superseded_by'),
  ('invoice_tax_kind'),
  ('invoice_untaxed_amount'),
  ('invoices_deposit'),
  ('invoices_first_viewed'),
  ('invoices_ledger_account'),
  ('kas_opening_balance'),
  ('kilometeradministratie'),
  ('kluis_subscriptions'),
  ('ledger_daily'),
  ('mollie'),
  ('mollie_settlements'),
  ('mollie_settlements_fee_paid'),
  ('ochtend_mail'),
  ('offerte_akkoord'),
  ('ontvangen_fair_use_pauze'),
  ('ontvangen_fair_use_per_document'),
  ('ontvangen_intake_intent'),
  ('ontvangen_melding_event_key'),
  ('ontvangen_uniek_document_per_factuur'),
  ('package_deliveries'),
  ('package_shares'),
  ('paid_invoice_money_frozen'),
  ('pay_bundles'),
  ('plan_grants'),
  ('profile_vak'),
  ('push_subscriptions'),
  ('readiness_cache'),
  ('regime_kor'),
  ('register_profile_from_metadata'),
  ('reminders_on_by_default'),
  ('repair_mandate_policies'),
  ('retention_purge'),
  ('revoke_execute_on_trigger_functions'),
  ('rls_initplan_wrap_auth_calls'),
  ('rpc_anon_revoke'),
  ('search_bank_cash'),
  ('search_engine'),
  ('search_engine_clients_kvk_city'),
  ('search_smart'),
  ('seed_invoice_counter'),
  ('snelstart_claim_before_push'),
  ('snelstart_connection'),
  ('storage_bucket_hardening'),
  ('subscription_plans_fair_use'),
  ('supplier_aliases'),
  ('supplier_backfill'),
  ('supplier_country'),
  ('supplier_defaults'),
  ('supplier_edit'),
  ('supplier_kvk_index'),
  ('supplier_registry'),
  ('system_events'),
  ('till_sales'),
  ('time_entries_declarabel'),
  ('urenregistratie'),
  ('usage_counters_internal_metrics'),
  ('vat_exemption'),
  ('vat_reverse_charge'),
  ('vat_scheme'),
  ('vat_statement_note'),
  ('vehicles'),
  ('verwerkt_freeze_level'),
  ('wachtkoppelingen'),
  ('welcome_grant_retired'),
  ('work_done_counts'),
  ('work_items'),
  ('work_items_offerte'),
  ('work_items_periods'),
  ('work_items_repeat'),
  ('work_items_repeat_kwartaal')
),
acknowledged(version, name, repo_file, functions, reason) AS (VALUES
  ('20260820203635', 'profile_vak', 'profile_vak.sql', ARRAY['handle_new_user']::text[], 'same-named repo file; recorded here because the production row also rewrites handle_new_user'),
  ('20260831194434', 'accountant_discount_guard', 'accountant_discount_guard.sql', ARRAY['prevent_accountant_amount_changes']::text[], 'same-named repo file'),
  ('20260901232158', 'rls_baseline_snapshot_before_initplan', NULL, ARRAY[]::text[], 'snapshot of pg_policies into rls_backup.policies_20260901 before the initplan rewrite, with REVOKEs on that schema and table; creates no function, no repo file'),
  ('20260912162856', 'anon_owner_oracle_revoke', NULL, ARRAY[]::text[], 'the [ANON-ORAKEL] incident: revoked anon from is_my_accountant_client/acting_for_owner and broke anonymous reads; rolled back by the three rows that follow'),
  ('20260912162934', 'anon_owner_oracle_revoke_from_public', NULL, ARRAY[]::text[], 'second step of the same incident'),
  ('20260912163155', 'anon_owner_oracle_revoke_rollback', NULL, ARRAY[]::text[], 'rollback of the incident: anon re-granted'),
  ('20260912163226', 'anon_owner_oracle_restore_public_grant', NULL, ARRAY[]::text[], 'rollback of the incident: PUBLIC re-granted'),
  ('20260913001416', 'bundel_drempel_book_bank_batch_status', 'bank_rpc_never_payable_states.sql', ARRAY['book_bank_batch']::text[], 'book_bank_batch body from bank_rpc_never_payable_states.sql, applied as its own MCP migration'),
  ('20260913202148', 'mollie_refunds', NULL, ARRAY[]::text[], 'the mollie_refunds table and its policy; MCP-applied, no repo file (table drift, tracked with the refund functions)'),
  ('20260913202207', 'subscription_price_snapshot', 'billing_subscription.sql', ARRAY['prevent_billing_self_grant']::text[], 'the [PRIJS-MOMENT] price snapshot; its prevent_billing_self_grant rewrite lives in billing_subscription.sql'),
  ('20260913202234', 'invoice_reverse_payment', NULL, ARRAY['reverse_invoice_payment']::text[], 'MCP-applied, no repo file; registry row carries the recovered intent (authenticated + service_role)'),
  ('20260913221343', 'mollie_refund_answer', NULL, ARRAY['answer_mollie_refund','mollie_refund_reason_of']::text[], 'MCP-applied, no repo file; registry rows carry the recovered intent (service_role only)'),
  ('20260913223813', 'mandate_requires_accountant_role', NULL, ARRAY['has_active_invoice_mandate']::text[], 'MCP-applied rewrite of has_active_invoice_mandate; body-only (CREATE OR REPLACE keeps the ACL), no repo file'),
  ('20260915122913', 'bank_rpc_never_payable_states_apply', 'bank_rpc_never_payable_states.sql', ARRAY['apply_bank_payment']::text[], 'one third of bank_rpc_never_payable_states.sql, applied per function'),
  ('20260915123016', 'bank_rpc_never_payable_states_confirm', 'bank_rpc_never_payable_states.sql', ARRAY['confirm_bank_payment']::text[], 'one third of bank_rpc_never_payable_states.sql, applied per function'),
  ('20260915123124', 'bank_rpc_never_payable_states_allocate', 'bank_rpc_never_payable_states.sql', ARRAY['allocate_bank_payment']::text[], 'one third of bank_rpc_never_payable_states.sql, applied per function'),
  ('20260916061228', 'handgeschreven_boeking_line_claim_guard', 'bank_confirm_atomic.sql', ARRAY['confirm_bank_payment']::text[], 'confirm_bank_payment body from the [HANDGESCHREVEN-BOEKING] work, applied as its own MCP migration'),
  ('20260916082807', 'verplaats_teken_move_payment_sign_lock', 'invoice_move_payment_creditnota_guard.sql', ARRAY['move_invoice_payment']::text[], 'move_invoice_payment body from the sign-lock work, applied as its own MCP migration'),
  ('20260916114241', 'lijn_budget_apply_bank_payment', 'invoice_partial_payments.sql', ARRAY['apply_bank_payment']::text[], 'apply_bank_payment body from the [LIJN-BUDGET-APPLY] work, applied as its own MCP migration'),
  ('20260919104749', 'ontvangen_fair_use_rpc_revoke_client_roles', 'ontvangen_fair_use_per_document.sql', ARRAY[]::text[], 'the REVOKE block at the end of ontvangen_fair_use_per_document.sql, applied as its own MCP migration')
),
history AS (
  SELECT s.version, s.name,
         array_to_string(s.statements, E'\n') AS sql_text,
         md5(array_to_string(s.statements, E'\n')) AS statements_md5
    FROM supabase_migrations.schema_migrations s
),
classified AS (
  SELECT h.version, h.name, h.statements_md5,
         (h.sql_text ~* '(create\s+(or\s+replace\s+)?function|\mgrant\M|\mrevoke\M|alter\s+default\s+privileges|security\s+definer|alter\s+function)') AS privilege_relevant,
         coalesce((SELECT array_agg(DISTINCT lower(m[1]) ORDER BY lower(m[1]))
                     FROM regexp_matches(h.sql_text, 'create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)', 'gi') AS m),
                  ARRAY[]::text[]) AS creates_functions,
         (r.name IS NOT NULL) AS in_repo,
         a.repo_file, a.functions AS acknowledged_functions, a.reason
    FROM history h
    LEFT JOIN repo r ON r.name = h.name
    LEFT JOIN acknowledged a ON a.version = h.version
)
SELECT version, name,
       CASE WHEN NOT privilege_relevant THEN 'not privilege-relevant'
            WHEN in_repo AND reason IS NULL THEN 'REPO'
            WHEN reason IS NOT NULL AND creates_functions = acknowledged_functions THEN 'ACKNOWLEDGED'
            WHEN reason IS NOT NULL THEN 'ACKNOWLEDGED_BUT_DIFFERENT'
            ELSE 'DRIFT' END AS provenance,
       creates_functions, repo_file, reason, statements_md5
  FROM classified
 ORDER BY CASE WHEN NOT privilege_relevant THEN 2 WHEN in_repo OR reason IS NOT NULL THEN 1 ELSE 0 END, version;

-- ═══ 4. THE MEASURED BASELINE this registry was written against ═══════════════════════════════════
-- Effective privileges as recorded in scripts/privilege-registry.ts (field `current`). Block 1 is
-- the live truth; this block exists so a reader can see what the registry BELIEVED when a DRIFT
-- row appears, without opening the TypeScript.
--   sig | anon | authenticated | service_role | public entry | acl_md5 (forensic)
--   public.allocate_bank_payment(uuid, uuid, uuid, numeric, date) | false | true | true | false | d1707186c8e5f1577bde2338d7541aec
--   public.apply_bank_payment(uuid, uuid, uuid, numeric, date) | false | true | true | false | d1707186c8e5f1577bde2338d7541aec
--   public.apply_manual_payment(uuid, uuid, numeric, date, text, text[], uuid) | false | true | true | false | d1707186c8e5f1577bde2338d7541aec
--   public.book_bank_batch(uuid, uuid, uuid[], date) | false | true | true | false | d1707186c8e5f1577bde2338d7541aec
--   public.confirm_bank_payment(uuid, uuid, uuid, date) | false | true | true | false | 06c8bd810f2d9a52a993cd903c13793a
--   public.move_invoice_payment(uuid, uuid, uuid) | false | true | true | false | d1707186c8e5f1577bde2338d7541aec
--   public.next_invoice_seq(uuid, integer, text) | false | true | true | false | d1707186c8e5f1577bde2338d7541aec
--   public.is_my_accountant_client(uuid) | true | true | true | true | e92c9b8bbc8cbf48623f6bc88746bbad
--   public.acting_for_owner() | true | true | true | true | e92c9b8bbc8cbf48623f6bc88746bbad
--   public.audit_row_is_about_me(text, uuid, uuid) | false | true | true | false | d1707186c8e5f1577bde2338d7541aec
--   public.has_active_confirm_mandate(uuid, uuid) | false | true | true | false | d1707186c8e5f1577bde2338d7541aec
--   public.has_active_invoice_mandate(uuid, uuid) | false | true | true | false | d1707186c8e5f1577bde2338d7541aec
--   public.ai_budget_consume(bigint, bigint) | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.ai_budget_settle(bigint) | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.check_rate_limit(uuid, text, integer, integer) | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.check_rate_limit_key(text, text, integer, integer) | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.fair_use_consume(uuid, text, text, integer, integer) | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.fair_use_consume_for_document(uuid, uuid, text, integer) | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.fair_use_release(uuid, text, text, integer) | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.fair_use_release_for_document(uuid, uuid) | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.invoice_number_twins(uuid, uuid) | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.recompute_invoice_amount_paid(uuid, uuid) | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.seed_invoice_counter(uuid, integer, text, integer) | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.vault_delete_secret(uuid) | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.vault_read_secret(uuid) | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.vault_update_or_create_secret(uuid, text, text) | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.work_done_counts(uuid, date, date) | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.cleanup_old_rate_limits() | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.assert_credit_within_original() | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.assert_credit_within_rate() | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.handle_new_user() | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.prevent_verwerkt_invoice_changes() | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.accountant_status_door_only() | true | true | true | true | 791d2b1e22edbb03f97770724fbb588b
--   public.grant_welcome_plus() | true | true | true | true | 791d2b1e22edbb03f97770724fbb588b
--   public.reverse_invoice_payment(uuid, uuid) | false | true | true | false | d1707186c8e5f1577bde2338d7541aec
--   public.answer_mollie_refund(uuid, text, text, numeric) | false | true | true | false | d1707186c8e5f1577bde2338d7541aec
--   public.search_clients_fuzzy(text) | true | true | true | true | 791d2b1e22edbb03f97770724fbb588b
--   public.search_documents_fuzzy(text) | true | true | true | true | 791d2b1e22edbb03f97770724fbb588b
--   public.search_folders_fuzzy(text) | true | true | true | true | 791d2b1e22edbb03f97770724fbb588b
--   public.search_invoices_fuzzy(text) | true | true | true | true | 791d2b1e22edbb03f97770724fbb588b
--   public.mollie_refund_reason_of(text) | true | true | true | false | 37a7ab878ddb3c8de2877e90e7224b7e
--   public.get_accountant_for_zzper(uuid) | true | true | true | true | 791d2b1e22edbb03f97770724fbb588b
--   public.assert_paid_is_backed() | true | true | true | true | 791d2b1e22edbb03f97770724fbb588b
--   public.documents_search_vector_update() | true | true | true | true | 791d2b1e22edbb03f97770724fbb588b
--   public.prevent_billing_self_grant() | true | true | true | true | 791d2b1e22edbb03f97770724fbb588b
--   public.prevent_paid_invoice_rewrite() | true | true | true | true | 791d2b1e22edbb03f97770724fbb588b
--   public.set_updated_at() | true | true | true | true | 791d2b1e22edbb03f97770724fbb588b
--   public.touch_updated_at() | true | true | true | true | 791d2b1e22edbb03f97770724fbb588b
--   public.assert_bookkeeping_date_sane() | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.guard_paid_when_verwerkt() | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.invoices_search_vector_update() | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
--   public.prevent_accountant_amount_changes() | false | false | true | false | db23e67d6fad77fdfa003856d807d6af
