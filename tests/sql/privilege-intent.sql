-- tests/sql/privilege-intent.sql
-- [PRIVILEGE-REGISTRY] GENERATED from scripts/privilege-registry.ts — do not edit by hand.
-- Regenerate with:  npx tsx scripts/privilege-oracle.ts --write
--
-- The registry's intent, as a temp table the SQL seam can join against the real catalog after a
-- test's migrations have run. acl_files lists the repo migrations whose GRANT/REVOKE statements
-- shape that function's privileges; a comparison is HARD only when every one of them was loaded,
-- and reported as partial otherwise (see tests/sql/privilege-check.sql).
--
-- UNKNOWN is a value here, not a boolean: the check never turns it into a pass or a fail.

DROP TABLE IF EXISTS privilege_intent;
CREATE TEMP TABLE privilege_intent (
  sig               text PRIMARY KEY,
  kind              text NOT NULL,
  status            text NOT NULL,
  definer           boolean NOT NULL,
  i_anon            text NOT NULL CHECK (i_anon IN ('ALLOW','DENY','UNKNOWN')),
  i_authenticated   text NOT NULL CHECK (i_authenticated IN ('ALLOW','DENY','UNKNOWN')),
  i_service_role    text NOT NULL CHECK (i_service_role IN ('ALLOW','DENY','UNKNOWN')),
  i_public          text NOT NULL CHECK (i_public IN ('ALLOW','DENY','UNKNOWN')),
  dev_anon          text,
  dev_authenticated text,
  dev_service_role  text,
  dev_public        text,
  acl_files         text[] NOT NULL
);

INSERT INTO privilege_intent (sig, kind, status, definer, i_anon, i_authenticated, i_service_role, i_public, dev_anon, dev_authenticated, dev_service_role, dev_public, acl_files) VALUES
  ('public.allocate_bank_payment(uuid, uuid, uuid, numeric, date)', 'client_rpc', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['allocate_bank_payment.sql','bank_rpc_never_payable_states.sql','rpc_anon_revoke.sql']::text[]),
  ('public.apply_bank_payment(uuid, uuid, uuid, numeric, date)', 'client_rpc', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['bank_rpc_never_payable_states.sql','invoice_partial_payments.sql','rpc_anon_revoke.sql']::text[]),
  ('public.apply_manual_payment(uuid, uuid, numeric, date, text, text[], uuid)', 'client_rpc', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['invoice_manual_payments.sql','rpc_anon_revoke.sql']::text[]),
  ('public.book_bank_batch(uuid, uuid, uuid[], date)', 'client_rpc', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['bank_confirm_atomic.sql','book_bank_batch_atomic.sql','rpc_anon_revoke.sql']::text[]),
  ('public.confirm_bank_payment(uuid, uuid, uuid, date)', 'client_rpc', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['bank_confirm_atomic.sql','bank_rpc_never_payable_states.sql','confirm_bank_payment_regrant.sql','rpc_anon_revoke.sql']::text[]),
  ('public.move_invoice_payment(uuid, uuid, uuid)', 'client_rpc', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['invoice_move_payment.sql','invoice_move_payment_creditnota_guard.sql','rpc_anon_revoke.sql']::text[]),
  ('public.next_invoice_seq(uuid, integer, text)', 'client_rpc', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['factuur_b_numbering.sql','rpc_anon_revoke.sql']::text[]),
  ('public.is_my_accountant_client(uuid)', 'rls_helper', 'live', true, 'ALLOW', 'ALLOW', 'ALLOW', 'UNKNOWN', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.acting_for_owner()', 'rls_helper', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', 'resolved by the 2026-09-20 evidence pass; production privilege deliberately unchanged in that PR; anon EXECUTE is default-grant residue, not a policy dependency; left in place until a separate hardening step', NULL, NULL, 'resolved by the 2026-09-20 evidence pass; production privilege deliberately unchanged in that PR; the PUBLIC entry is the CREATE-time default, not a policy dependency; left in place until a separate hardening step', ARRAY[]::text[]),
  ('public.audit_row_is_about_me(text, uuid, uuid)', 'rls_helper', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['anon_mandate_oracle_revoke.sql']::text[]),
  ('public.has_active_confirm_mandate(uuid, uuid)', 'rls_helper', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['anon_mandate_oracle_revoke.sql']::text[]),
  ('public.has_active_invoice_mandate(uuid, uuid)', 'rls_helper', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['anon_mandate_oracle_revoke.sql']::text[]),
  ('public.ai_budget_consume(bigint, bigint)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['ai_spend_guard.sql']::text[]),
  ('public.ai_budget_settle(bigint)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['ai_budget_settle.sql']::text[]),
  ('public.check_rate_limit(uuid, text, integer, integer)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.check_rate_limit_key(text, text, integer, integer)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['ai_spend_guard.sql']::text[]),
  ('public.fair_use_consume(uuid, text, text, integer, integer)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['fair_use_usage.sql','rpc_anon_revoke.sql']::text[]),
  ('public.fair_use_consume_for_document(uuid, uuid, text, integer)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['ontvangen_fair_use_per_document.sql']::text[]),
  ('public.fair_use_release(uuid, text, text, integer)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['fair_use_usage.sql','rpc_anon_revoke.sql']::text[]),
  ('public.fair_use_release_for_document(uuid, uuid)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['ontvangen_fair_use_per_document.sql']::text[]),
  ('public.invoice_number_twins(uuid, uuid)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['invoice_number_twins.sql']::text[]),
  ('public.recompute_invoice_amount_paid(uuid, uuid)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['invoice_partial_payments.sql','invoice_payment_date_rederive.sql','rpc_anon_revoke.sql']::text[]),
  ('public.seed_invoice_counter(uuid, integer, text, integer)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['rpc_anon_revoke.sql','seed_invoice_counter.sql']::text[]),
  ('public.vault_delete_secret(uuid)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.vault_read_secret(uuid)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.vault_update_or_create_secret(uuid, text, text)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.work_done_counts(uuid, date, date)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['work_done_counts.sql']::text[]),
  ('public.cleanup_old_rate_limits()', 'internal', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY[]::text[]),
  ('public.assert_credit_within_original()', 'trigger', 'live', true, 'DENY', 'DENY', 'UNKNOWN', 'DENY', NULL, NULL, NULL, NULL, ARRAY['rpc_anon_revoke.sql']::text[]),
  ('public.assert_credit_within_rate()', 'trigger', 'live', true, 'DENY', 'DENY', 'UNKNOWN', 'DENY', NULL, NULL, NULL, NULL, ARRAY['revoke_execute_on_trigger_functions.sql']::text[]),
  ('public.handle_new_user()', 'trigger', 'live', true, 'DENY', 'DENY', 'UNKNOWN', 'DENY', NULL, NULL, NULL, NULL, ARRAY['rpc_anon_revoke.sql']::text[]),
  ('public.prevent_verwerkt_invoice_changes()', 'trigger', 'live', true, 'DENY', 'DENY', 'UNKNOWN', 'DENY', NULL, NULL, NULL, NULL, ARRAY['revoke_execute_on_trigger_functions.sql']::text[]),
  ('public.accountant_status_door_only()', 'trigger', 'live', true, 'DENY', 'DENY', 'UNKNOWN', 'UNKNOWN', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', NULL, NULL, ARRAY[]::text[]),
  ('public.grant_welcome_plus()', 'trigger', 'live', true, 'DENY', 'DENY', 'UNKNOWN', 'UNKNOWN', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', NULL, NULL, ARRAY[]::text[]),
  ('public.reverse_invoice_payment(uuid, uuid)', 'server_rpc', 'live', true, 'DENY', 'ALLOW', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['anon_revoke_refund_writers.sql']::text[]),
  ('public.answer_mollie_refund(uuid, text, text, numeric)', 'server_rpc', 'live', true, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, 'resolved by the 2026-09-20 evidence pass; production privilege deliberately unchanged in that PR; authenticated EXECUTE is the creation-time named default grant that REVOKE FROM PUBLIC never touched; no caller uses it; left in place until a separate hardening step', NULL, NULL, ARRAY['anon_revoke_refund_writers.sql']::text[]),
  ('public.search_clients_fuzzy(text)', 'invoker_rpc', 'live', false, 'DENY', 'ALLOW', 'ALLOW', 'UNKNOWN', 'PUBLIC default entry never revoked; later hardening, not this PR', NULL, NULL, NULL, ARRAY['search_smart.sql']::text[]),
  ('public.search_documents_fuzzy(text)', 'invoker_rpc', 'live', false, 'DENY', 'ALLOW', 'ALLOW', 'UNKNOWN', 'PUBLIC default entry never revoked; later hardening, not this PR', NULL, NULL, NULL, ARRAY['search_smart.sql']::text[]),
  ('public.search_folders_fuzzy(text)', 'invoker_rpc', 'live', false, 'DENY', 'ALLOW', 'ALLOW', 'UNKNOWN', 'PUBLIC default entry never revoked; later hardening, not this PR', NULL, NULL, NULL, ARRAY['search_smart.sql']::text[]),
  ('public.search_invoices_fuzzy(text)', 'invoker_rpc', 'live', false, 'DENY', 'ALLOW', 'ALLOW', 'UNKNOWN', 'PUBLIC default entry never revoked; later hardening, not this PR', NULL, NULL, NULL, ARRAY['search_smart.sql']::text[]),
  ('public.mollie_refund_reason_of(text)', 'internal', 'live', false, 'DENY', 'DENY', 'ALLOW', 'DENY', 'original migration intended service_role only; anon/authenticated kept by the default grant; no change in this PR', 'original migration intended service_role only; no change in this PR', NULL, NULL, ARRAY[]::text[]),
  ('public.get_accountant_for_zzper(uuid)', 'obsolete', 'live', false, 'DENY', 'DENY', 'DENY', 'DENY', 'resolved by the 2026-09-20 evidence pass; production privilege deliberately unchanged in that PR; obsolete / no live caller found; the grant is legacy default exposure kept until an owner-approved DROP', 'resolved by the 2026-09-20 evidence pass; production privilege deliberately unchanged in that PR; obsolete / no live caller found; the grant is legacy default exposure kept until an owner-approved DROP', 'resolved by the 2026-09-20 evidence pass; production privilege deliberately unchanged in that PR; obsolete / no live caller found; the grant is legacy default exposure kept until an owner-approved DROP', 'resolved by the 2026-09-20 evidence pass; production privilege deliberately unchanged in that PR; obsolete / no live caller found; the grant is legacy default exposure kept until an owner-approved DROP', ARRAY[]::text[]),
  ('public.assert_paid_is_backed()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'UNKNOWN', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', NULL, NULL, ARRAY[]::text[]),
  ('public.documents_search_vector_update()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'UNKNOWN', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', NULL, NULL, ARRAY[]::text[]),
  ('public.prevent_billing_self_grant()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'UNKNOWN', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', NULL, NULL, ARRAY[]::text[]),
  ('public.prevent_paid_invoice_rewrite()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'UNKNOWN', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', NULL, NULL, ARRAY[]::text[]),
  ('public.set_updated_at()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'UNKNOWN', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', NULL, NULL, ARRAY[]::text[]),
  ('public.touch_updated_at()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'UNKNOWN', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', 'trigger functions need no EXECUTE; the anon grant is inert but not yet removed (later hardening pass, not this PR)', NULL, NULL, ARRAY[]::text[]),
  ('public.assert_bookkeeping_date_sane()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'DENY', NULL, NULL, NULL, NULL, ARRAY['revoke_execute_on_trigger_functions.sql']::text[]),
  ('public.guard_paid_when_verwerkt()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'DENY', NULL, NULL, NULL, NULL, ARRAY['revoke_execute_on_trigger_functions.sql']::text[]),
  ('public.invoices_search_vector_update()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'DENY', NULL, NULL, NULL, NULL, ARRAY['revoke_execute_on_trigger_functions.sql']::text[]),
  ('public.prevent_accountant_amount_changes()', 'trigger', 'live', false, 'DENY', 'DENY', 'UNKNOWN', 'DENY', NULL, NULL, NULL, NULL, ARRAY['revoke_execute_on_trigger_functions.sql']::text[]),
  ('public.accountant_set_invoice_status(uuid, uuid, uuid, text, text)', 'server_rpc', 'planned', false, 'DENY', 'DENY', 'ALLOW', 'DENY', NULL, NULL, NULL, NULL, ARRAY['accountant_invoice_status_sync.sql']::text[]),
  ('public.document_is_referenced(uuid)', 'invoker_rpc', 'not_in_production', false, 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', NULL, NULL, NULL, NULL, ARRAY[]::text[]);
