-- =====================================================================
-- WELKE MIGRATIES STAAN ER ÉCHT? — één query, het echte antwoord.
-- BoekBrug · automatisch gegenereerd, NIET met de hand bijwerken.
-- =====================================================================
--
-- GEGENEREERD DOOR: scripts/migration-inventory.ts
--   npx tsx scripts/migration-inventory.ts > docs/WELKE_MIGRATIES_STAAN_ER.sql
--
-- Handmatige wijzigingen gaan bij de eerstvolgende run verloren, en een poort in
-- lifecycle-gates.test.ts faalt zodra dit bestand niet meer overeenkomt met de map.
--
-- ── WAAROM GEGENEREERD ──
--
-- De vorige versie stelde de goede vraag met een lijst die iemand met de hand bijhield, en
-- zei daar zelf over: "Het ANTWOORD komt uit de database, maar de VRAAG staat hier met de
-- hand in. Een migratie die er niet in staat, kan dit bestand ook niet 'OPEN' noemen." Dat is
-- twee keer misgegaan — één keer dekte de lijst 17 van 71 migraties en gaf een schoon "alles
-- toegepast" terug, met de vier waar de betaalkant op leunt er niet in.
--
-- Nu wordt de vraag AFGELEID uit supabase/migrations/, en kan hij niet achterlopen op de map.
--
-- ── WAT DE UITKOMST BETEKENT ──
--
--   TOEGEPAST     elk object dat deze migratie aanmaakt, bestaat.
--   GEDEELTELIJK  sommige wel, sommige niet. Dit is het gevaarlijke geval: de migratie is
--                 halverwege gestopt. Lees het CONTROLE-blok onderaan dát migratiebestand.
--   OPEN          geen enkel object bestaat.
--
-- "TOEGEPAST" bewijst dat de migratie GEDRAAID heeft, niet dat ze FOUTLOOS liep. Daarvoor is
-- het CONTROLE-blok onderaan het migratiebestand zelf.
--
-- ── TWEE QUERY'S, WANT ER ZIJN TWEE SOORTEN MIGRATIES ──
--
--   DEEL 1  de 158 migraties die iets AANMAKEN. Bestaat het object, dan is ze gedraaid.
--   DEEL 2  de 19 die niets aanmaken — alleen rechten intrekken, iets weggooien of een
--           stand goed zetten. Daar wordt de STAND gemeten in plaats van het bestaan.
--
-- Draai ze allebei. Deel 1 alleen is een schoon rapport met twee veiligheidsmigraties er
-- buiten: staat de documentenbucket privé, en mag anon de geldfuncties nog aanroepen.
--
-- Leest alleen de catalogus. Verandert niets. Draai hem als service_role in de SQL-editor.
-- =====================================================================

-- ── DEEL 1 ──────────────────────────────────────────────────────────

with probe(bestand, soort, object, tabel, schema) as (values
  ('account_purpose_archief.sql', 'function_body', 'handle_new_user', '.email,.id,.raw_user_meta_data', 'public'),
  ('account_purpose_archief.sql', 'column', 'account_purpose', 'profiles', 'public'),
  ('account_purpose_archief.sql', 'constraint', 'profiles_account_purpose_check', null, 'public'),
  ('accountant_amount_guard_restore.sql', 'function_body', 'prevent_accountant_amount_changes', '.amount_paid,.btw_amount,.direction,.discount_type,.discount_value,.document_id,.due_date,.id,.invoice_date,.invoice_number,.invoice_type,.marked_paid_at,.pay_token,.payment_date,.payment_method,.payment_prepared_at,.payment_reference,.receiver_id,.sender_id,.status,.total_ex_btw,.total_inc_btw,.vat_deduction,.vendor_iban', 'public'),
  ('accountant_confirm_mandate.sql', 'function_body', 'has_active_invoice_mandate', 'facturen', 'public'),
  ('accountant_confirm_mandate.sql', 'function_body', 'prevent_accountant_amount_changes', '.amount_paid,.btw_amount,.direction,.discount_type,.discount_value,.document_id,.due_date,.id,.invoice_date,.invoice_number,.invoice_type,.marked_paid_at,.pay_token,.payment_date,.payment_method,.payment_prepared_at,.payment_reference,.receiver_id,.sender_id,.status,.total_ex_btw,.total_inc_btw,.vat_deduction,.vendor_iban', 'public'),
  ('accountant_confirm_mandate.sql', 'column', 'confirmed_by', 'invoices', 'public'),
  ('accountant_confirm_mandate.sql', 'column', 'kind', 'accountant_invoice_mandates', 'public'),
  ('accountant_confirm_mandate.sql', 'constraint', 'accountant_invoice_mandates_kind_check', null, 'public'),
  ('accountant_confirm_mandate.sql', 'function', 'has_active_confirm_mandate', null, 'public'),
  ('accountant_directory.sql', 'constraint', 'accountant_directory_lengths', null, 'public'),
  ('accountant_directory.sql', 'constraint', 'accountant_directory_published_is_complete', null, 'public'),
  ('accountant_directory.sql', 'constraint', 'accountant_directory_website_https', null, 'public'),
  ('accountant_directory.sql', 'index', 'accountant_directory_published_idx', null, 'public'),
  ('accountant_directory.sql', 'policy', 'accountant_directory_own_delete', 'accountant_directory', 'public'),
  ('accountant_directory.sql', 'policy', 'accountant_directory_own_read', 'accountant_directory', 'public'),
  ('accountant_discount_guard.sql', 'function_body', 'prevent_accountant_amount_changes', '.amount_paid,.btw_amount,.direction,.discount_type,.discount_value,.document_id,.due_date,.id,.invoice_date,.invoice_number,.invoice_type,.marked_paid_at,.pay_token,.payment_date,.payment_method,.payment_prepared_at,.payment_reference,.receiver_id,.sender_id,.status,.total_ex_btw,.total_inc_btw,.vat_deduction,.vendor_iban', 'public'),
  ('accountant_invoice_mandate.sql', 'function_body', 'next_invoice_seq', 'has_active_invoice_mandate', 'public'),
  ('accountant_invoice_mandate.sql', 'function_body', 'prevent_accountant_amount_changes', '.amount_paid,.btw_amount,.direction,.discount_type,.discount_value,.document_id,.due_date,.id,.invoice_date,.invoice_number,.invoice_type,.marked_paid_at,.pay_token,.payment_date,.payment_method,.payment_prepared_at,.payment_reference,.receiver_id,.sender_id,.status,.total_ex_btw,.total_inc_btw,.vat_deduction,.vendor_iban', 'public'),
  ('accountant_invoice_mandate.sql', 'function', 'has_active_invoice_mandate', null, 'public'),
  ('accountant_invoice_mandate.sql', 'index', 'accountant_invoice_mandates_accountant', null, 'public'),
  ('accountant_invoice_mandate.sql', 'policy', 'accountant_invoice_mandates_select', 'accountant_invoice_mandates', 'public'),
  ('accountant_invoice_mandate.sql', 'policy', 'invoice_lines_mandate_read', 'invoice_lines', 'public'),
  ('accountant_subject_status.sql', 'policy', 'acc_status_client_read_document', 'accountant_subject_status', 'public'),
  ('accountant_subject_status.sql', 'table', 'accountant_subject_status', null, 'public'),
  ('accountant_vat_deduction_guard.sql', 'function_body', 'prevent_accountant_amount_changes', '.amount_paid,.btw_amount,.direction,.discount_type,.discount_value,.document_id,.due_date,.id,.invoice_date,.invoice_number,.invoice_type,.marked_paid_at,.pay_token,.payment_date,.payment_method,.payment_prepared_at,.payment_reference,.receiver_id,.sender_id,.status,.total_ex_btw,.total_inc_btw,.vat_deduction,.vendor_iban', 'public'),
  ('accountant_write_guard_fix.sql', 'function_body', 'prevent_accountant_amount_changes', '.amount_paid,.btw_amount,.direction,.discount_type,.discount_value,.document_id,.due_date,.id,.invoice_date,.invoice_number,.invoice_type,.marked_paid_at,.pay_token,.payment_date,.payment_method,.payment_prepared_at,.payment_reference,.receiver_id,.sender_id,.status,.total_ex_btw,.total_inc_btw,.vat_deduction,.vendor_iban', 'public'),
  ('accountant_write_holes.sql', 'function_body', 'prevent_accountant_amount_changes', '.amount_paid,.btw_amount,.direction,.discount_type,.discount_value,.document_id,.due_date,.id,.invoice_date,.invoice_number,.invoice_type,.marked_paid_at,.pay_token,.payment_date,.payment_method,.payment_prepared_at,.payment_reference,.receiver_id,.sender_id,.status,.total_ex_btw,.total_inc_btw,.vat_deduction,.vendor_iban', 'public'),
  ('accountant_write_holes.sql', 'index', 'idx_invoices_invoice_date', null, 'public'),
  ('accountant_write_holes.sql', 'index', 'idx_invoices_receiver_id', null, 'public'),
  ('accountant_write_holes.sql', 'index', 'idx_invoices_sender_id', null, 'public'),
  ('accountant_write_holes.sql', 'index', 'idx_invoices_shared', null, 'public'),
  ('accountant_write_holes.sql', 'policy', 'acc_status_owner_read', 'accountant_subject_status', 'public'),
  ('ai_budget_settle.sql', 'function', 'ai_budget_settle', null, 'public'),
  ('ai_spend_guard.sql', 'column', 'bucket_key', 'rate_limits', 'public'),
  ('ai_spend_guard.sql', 'constraint', 'rate_limits_one_identity', null, 'public'),
  ('ai_spend_guard.sql', 'function', 'ai_budget_consume', null, 'public'),
  ('ai_spend_guard.sql', 'function', 'check_rate_limit_key', null, 'public'),
  ('ai_spend_guard.sql', 'index', 'accountant_clients_accountant_idx', null, 'public'),
  ('ai_spend_guard.sql', 'index', 'rate_limits_bucket_endpoint_key', null, 'public'),
  ('allocate_bank_payment.sql', 'function', 'allocate_bank_payment', null, 'public'),
  ('articles.sql', 'index', 'idx_articles_user_active', null, 'public'),
  ('articles.sql', 'index', 'idx_articles_user_code', null, 'public'),
  ('articles.sql', 'policy', 'articles_delete_own', 'articles', 'public'),
  ('articles.sql', 'policy', 'articles_insert_own', 'articles', 'public'),
  ('articles.sql', 'policy', 'articles_select_own', 'articles', 'public'),
  ('articles.sql', 'policy', 'articles_update_own', 'articles', 'public'),
  ('assets.sql', 'index', 'idx_assets_user_in_use', null, 'public'),
  ('assets.sql', 'policy', 'asset_dismissals_delete_own', 'asset_dismissals', 'public'),
  ('assets.sql', 'policy', 'asset_dismissals_insert_own', 'asset_dismissals', 'public'),
  ('assets.sql', 'policy', 'asset_dismissals_select_own', 'asset_dismissals', 'public'),
  ('assets.sql', 'policy', 'assets_accountant_read', 'assets', 'public'),
  ('assets.sql', 'policy', 'assets_delete_own', 'assets', 'public'),
  ('audit_logs_client_read.sql', 'function', 'audit_row_is_about_me', null, 'public'),
  ('audit_logs_client_read.sql', 'policy', 'audit_logs_about_me', 'audit_logs', 'public'),
  ('auto_boeken.sql', 'column', 'auto_boeken', 'profiles', 'public'),
  ('auto_incasso.sql', 'column', 'auto_incasso', 'suppliers', 'public'),
  ('auto_incasso.sql', 'column', 'auto_incasso_since', 'suppliers', 'public'),
  ('auto_incasso.sql', 'index', 'idx_suppliers_auto_incasso', null, 'public'),
  ('bank_auto_book_blocked.sql', 'column', 'auto_book_blocked_at', 'bank_transactions', 'public'),
  ('bank_auto_book_blocked.sql', 'index', 'bank_transactions_auto_book_open_idx', null, 'public'),
  ('bank_auto_match_reason.sql', 'column', 'auto_match_reason', 'bank_transactions', 'public'),
  ('bank_confirm_atomic.sql', 'function', 'book_bank_batch', null, 'public'),
  ('bank_confirm_atomic.sql', 'function', 'confirm_bank_payment', null, 'public'),
  ('bank_connections.sql', 'index', 'bank_connection_accounts_connection_idx', null, 'public'),
  ('bank_connections.sql', 'index', 'bank_connection_accounts_due_idx', null, 'public'),
  ('bank_connections.sql', 'index', 'bank_connections_reference_uidx', null, 'public'),
  ('bank_connections.sql', 'index', 'bank_connections_user_created_idx', null, 'public'),
  ('bank_connections.sql', 'policy', 'bank_connection_accounts_select_own', 'bank_connection_accounts', 'public'),
  ('bank_connections.sql', 'policy', 'bank_connections_select_own', 'bank_connections', 'public'),
  ('bank_connections_updated_at.sql', 'function', 'set_updated_at', null, 'public'),
  ('bank_identity.sql', 'column', 'category', 'bank_transactions', 'public'),
  ('bank_identity.sql', 'column', 'category_confirmed', 'bank_transactions', 'public'),
  ('bank_identity.sql', 'column', 'category_source', 'bank_transactions', 'public'),
  ('bank_identity.sql', 'index', 'idx_counterpart_memory_lookup', null, 'public'),
  ('bank_identity.sql', 'policy', 'counterpart_memory_delete_own', 'counterpart_memory', 'public'),
  ('bank_identity.sql', 'policy', 'counterpart_memory_insert_own', 'counterpart_memory', 'public'),
  ('bank_ignore_reason.sql', 'constraint_def', 'bank_transactions_ignore_reason_check', 'anders,dubbel,geen_factuur,niet_van_mij,prive', 'public'),
  ('bank_ignore_reason.sql', 'column', 'ignore_reason', 'bank_transactions', 'public'),
  ('bank_ignore_reason.sql', 'index', 'idx_bank_tx_ignore_reason', null, 'public'),
  ('bank_ignore_reason_storno.sql', 'constraint_def', 'bank_transactions_ignore_reason_check', 'anders,dubbel,geen_factuur,niet_van_mij,prive,storno', 'public'),
  ('bank_match_rejections.sql', 'index', 'bank_match_rejections_unique', null, 'public'),
  ('bank_match_rejections.sql', 'index', 'bank_match_rejections_user', null, 'public'),
  ('bank_match_rejections.sql', 'policy', 'bank_match_rejections_delete_own', 'bank_match_rejections', 'public'),
  ('bank_match_rejections.sql', 'policy', 'bank_match_rejections_insert_own', 'bank_match_rejections', 'public'),
  ('bank_match_rejections.sql', 'policy', 'bank_match_rejections_select_own', 'bank_match_rejections', 'public'),
  ('bank_match_rejections.sql', 'table', 'bank_match_rejections', null, 'public'),
  ('bank_rpc_never_payable_states.sql', 'function', 'allocate_bank_payment', null, 'public'),
  ('bank_rpc_never_payable_states.sql', 'function', 'apply_bank_payment', null, 'public'),
  ('bank_rpc_never_payable_states.sql', 'function', 'confirm_bank_payment', null, 'public'),
  ('bank_statement_periods.sql', 'index', 'idx_bsp_user_iban_start', null, 'public'),
  ('bank_statement_periods.sql', 'policy', 'bsp_owner_read', 'bank_statement_periods', 'public'),
  ('bank_statement_periods.sql', 'table', 'bank_statement_periods', null, 'public'),
  ('bank_tx_attachments.sql', 'index', 'bank_tx_attachments_tx_idx', null, 'public'),
  ('bank_tx_attachments.sql', 'index', 'bank_tx_attachments_user_idx', null, 'public'),
  ('bank_tx_attachments.sql', 'policy', 'bank_tx_attachments_owner_read', 'bank_tx_attachments', 'public'),
  ('bank_tx_attachments.sql', 'table', 'bank_tx_attachments', null, 'public'),
  ('bank_tx_counterpart_iban.sql', 'column', 'counterpart_iban', 'bank_transactions', 'public'),
  ('bank_tx_counterpart_iban.sql', 'index', 'idx_bank_transactions_counterpart_iban', null, 'public'),
  ('bank_tx_direct_debit.sql', 'column', 'creditor_id', 'bank_transactions', 'public'),
  ('bank_tx_direct_debit.sql', 'column', 'incasso_suggested_at', 'suppliers', 'public'),
  ('bank_tx_direct_debit.sql', 'column', 'mandate_id', 'bank_transactions', 'public'),
  ('bank_tx_direct_debit.sql', 'column', 'type_code', 'bank_transactions', 'public'),
  ('bank_tx_direct_debit.sql', 'index', 'idx_bank_tx_direct_debit', null, 'public'),
  ('bank_tx_invoices.sql', 'index', 'bank_tx_invoices_unique_pair', null, 'public'),
  ('bank_tx_invoices.sql', 'index', 'idx_bank_tx_invoices_inv', null, 'public'),
  ('bank_tx_invoices.sql', 'index', 'idx_bank_tx_invoices_tx', null, 'public'),
  ('bank_tx_invoices.sql', 'index', 'idx_bank_tx_invoices_user', null, 'public'),
  ('bank_tx_invoices.sql', 'policy', 'bank_tx_invoices_select_own', 'bank_tx_invoices', 'public'),
  ('bank_tx_invoices.sql', 'table', 'bank_tx_invoices', null, 'public'),
  ('bank_tx_invoices_memory_index.sql', 'index', 'idx_bank_tx_invoices_user_recent', null, 'public'),
  ('bank_tx_invoices_read_only_policy.sql', 'policy', 'bank_tx_invoices_select_own', 'bank_tx_invoices', 'public'),
  ('bank_tx_source_identity.sql', 'column', 'external_id', 'bank_transactions', 'public'),
  ('bank_tx_source_identity.sql', 'column', 'source', 'bank_transactions', 'public'),
  ('bank_tx_source_identity.sql', 'index', 'uniq_bank_tx_source_identity', null, 'public'),
  ('bank_tx_statement_link.sql', 'column', 'statement_document_id', 'bank_transactions', 'public'),
  ('bank_tx_statement_link.sql', 'index', 'idx_bank_transactions_statement_doc', null, 'public'),
  ('betaalverzoek.sql', 'column', 'pay_token', 'invoices', 'public'),
  ('betaalverzoek.sql', 'index', 'idx_invoices_pay_token', null, 'public'),
  ('billing_subscription.sql', 'column', 'current_period_end', 'profiles', 'public'),
  ('billing_subscription.sql', 'column', 'stripe_customer_id', 'profiles', 'public'),
  ('billing_subscription.sql', 'column', 'subscription_status', 'profiles', 'public'),
  ('billing_subscription.sql', 'constraint', 'profiles_subscription_status_check', null, 'public'),
  ('billing_subscription.sql', 'function', 'prevent_billing_self_grant', null, 'public'),
  ('billing_subscription.sql', 'index', 'profiles_stripe_customer_id_key', null, 'public'),
  ('book_bank_batch_atomic.sql', 'function', 'book_bank_batch', null, 'public'),
  ('bookkeeping_date_sane.sql', 'function', 'assert_bookkeeping_date_sane', null, 'public'),
  ('btw_filings.sql', 'index', 'btw_filings_user_period_idx', null, 'public'),
  ('btw_filings.sql', 'policy', 'btw_filings own rows', 'btw_filings', 'public'),
  ('btw_filings.sql', 'table', 'btw_filings', null, 'public'),
  ('btw_filings_carried.sql', 'column', 'carried_at', 'btw_filings', 'public'),
  ('btw_filings_carried.sql', 'column', 'carried_into_quarter', 'btw_filings', 'public'),
  ('btw_filings_carried.sql', 'column', 'carried_into_year', 'btw_filings', 'public'),
  ('btw_filings_carried.sql', 'column', 'carried_saldo', 'btw_filings', 'public'),
  ('btw_filings_carried.sql', 'constraint', 'btw_filings_carried_quarter_check', null, 'public'),
  ('btw_filings_divergence.sql', 'column', 'first_divergence_at', 'btw_filings', 'public'),
  ('btw_filings_divergence.sql', 'column', 'last_divergence_at', 'btw_filings', 'public'),
  ('btw_filings_divergence.sql', 'index', 'btw_filings_diverged_idx', null, 'public'),
  ('cash_entry_soft_delete.sql', 'column', 'deleted_at', 'cash_entries', 'public'),
  ('cash_entry_soft_delete.sql', 'index', 'cash_entries_one_settlement_per_instalment', null, 'public'),
  ('cash_entry_soft_delete.sql', 'index', 'idx_cash_entries_user_date_live', null, 'public'),
  ('cash_ledger.sql', 'index', 'idx_cash_entries_user_date', null, 'public'),
  ('cash_ledger.sql', 'policy', 'cash_entries_delete_own', 'cash_entries', 'public'),
  ('cash_ledger.sql', 'policy', 'cash_entries_insert_own', 'cash_entries', 'public'),
  ('cash_ledger.sql', 'policy', 'cash_entries_select_own', 'cash_entries', 'public'),
  ('cash_ledger.sql', 'policy', 'cash_entries_update_own', 'cash_entries', 'public'),
  ('cash_ledger.sql', 'table', 'cash_entries', null, 'public'),
  ('cash_settlement_invoice_link.sql', 'column', 'invoice_id', 'cash_entries', 'public'),
  ('cash_settlement_per_instalment.sql', 'column', 'settlement_id', 'cash_entries', 'public'),
  ('cash_settlement_per_instalment.sql', 'index', 'cash_entries_one_settlement_per_instalment', null, 'public'),
  ('cash_settlement_per_instalment.sql', 'index', 'idx_cash_entries_settlement', null, 'public'),
  ('circle_integrity_and_indexes.sql', 'column', 'content_hash', 'documents', 'public'),
  ('circle_integrity_and_indexes.sql', 'column', 'last_synced_email_at', 'email_connections', 'public'),
  ('circle_integrity_and_indexes.sql', 'column', 'needs_reauth', 'email_connections', 'public'),
  ('circle_integrity_and_indexes.sql', 'column', 'shared', 'documents', 'public'),
  ('circle_integrity_and_indexes.sql', 'constraint', 'invoices_document_id_fkey', null, 'public'),
  ('circle_integrity_and_indexes.sql', 'index', 'idx_bank_transactions_invoice_id', null, 'public'),
  ('client_country.sql', 'column', 'client_country', 'invoices', 'public'),
  ('client_country.sql', 'column', 'country', 'clients', 'public'),
  ('client_extra_lines.sql', 'column', 'client_extra_line1', 'invoices', 'public'),
  ('client_extra_lines.sql', 'column', 'client_extra_line2', 'invoices', 'public'),
  ('client_extra_lines.sql', 'column', 'client_extra_line3', 'invoices', 'public'),
  ('client_extra_lines.sql', 'column', 'client_extra_line4', 'invoices', 'public'),
  ('clients_default_hourly_rate.sql', 'column', 'default_hourly_rate', 'clients', 'public'),
  ('clients_term_phone.sql', 'column', 'payment_term_days', 'clients', 'public'),
  ('clients_term_phone.sql', 'column', 'phone', 'clients', 'public'),
  ('company_members_sales_role.sql', 'column', 'created_by', 'invoices', 'public'),
  ('company_members_sales_role.sql', 'column', 'created_by', 'clients', 'public'),
  ('company_members_sales_role.sql', 'function', 'acting_for_owner', null, 'public'),
  ('company_members_sales_role.sql', 'function', 'next_invoice_seq', null, 'public'),
  ('company_members_sales_role.sql', 'index', 'clients_created_by_idx', null, 'public'),
  ('company_members_sales_role.sql', 'index', 'company_member_invites_owner_idx', null, 'public'),
  ('creditnota_external_reference.sql', 'column', 'credited_invoice_date', 'invoices', 'public'),
  ('creditnota_external_reference.sql', 'column', 'credited_invoice_number', 'invoices', 'public'),
  ('creditnota_partial.sql', 'function', 'assert_credit_within_original', null, 'public'),
  ('creditnota_per_rate_ceiling.sql', 'function', 'assert_credit_within_rate', null, 'public'),
  ('crm_backbone.sql', 'column', 'client_id', 'invoices', 'public'),
  ('crm_backbone.sql', 'column', 'notes', 'clients', 'public'),
  ('crm_backbone.sql', 'index', 'idx_invoices_client_id', null, 'public'),
  ('cron_runs.sql', 'index', 'cron_runs_job_started_idx', null, 'public'),
  ('cron_runs.sql', 'table', 'cron_runs', null, 'public'),
  ('daily_turnover.sql', 'index', 'idx_daily_turnover_user_date', null, 'public'),
  ('daily_turnover.sql', 'policy', 'daily_turnover_delete_own', 'daily_turnover', 'public'),
  ('daily_turnover.sql', 'policy', 'daily_turnover_insert_own', 'daily_turnover', 'public'),
  ('daily_turnover.sql', 'policy', 'daily_turnover_select_own', 'daily_turnover', 'public'),
  ('daily_turnover.sql', 'policy', 'daily_turnover_update_own', 'daily_turnover', 'public'),
  ('daily_turnover.sql', 'table', 'daily_turnover', null, 'public'),
  ('deletion_request_purge_warning.sql', 'column', 'purge_warning_sent_at', 'deletion_requests', 'public'),
  ('deletion_request_purge_warning.sql', 'index', 'deletion_requests_unwarned_idx', null, 'public'),
  ('documents_accountant_read_policy.sql', 'policy', 'documents_accountant_read', 'documents', 'public'),
  ('documents_content_hash_unique.sql', 'index', 'uq_documents_user_content_hash', null, 'public'),
  ('documents_shared_and_storage_policies.sql', 'column', 'content_hash', 'documents', 'public'),
  ('documents_shared_and_storage_policies.sql', 'column', 'shared', 'documents', 'public'),
  ('documents_shared_and_storage_policies.sql', 'policy', 'documents_delete', 'objects', 'storage'),
  ('documents_shared_and_storage_policies.sql', 'policy', 'documents_read', 'objects', 'storage'),
  ('documents_shared_and_storage_policies.sql', 'policy', 'documents_upload', 'objects', 'storage'),
  ('eft_settlements.sql', 'index', 'idx_eft_settlements_user_date', null, 'public'),
  ('eft_settlements.sql', 'policy', 'eft_settlements_delete_own', 'eft_settlements', 'public'),
  ('eft_settlements.sql', 'policy', 'eft_settlements_insert_own', 'eft_settlements', 'public'),
  ('eft_settlements.sql', 'policy', 'eft_settlements_select_own', 'eft_settlements', 'public'),
  ('eft_settlements.sql', 'policy', 'eft_settlements_update_own', 'eft_settlements', 'public'),
  ('eft_settlements.sql', 'table', 'eft_settlements', null, 'public'),
  ('email_failed_attempts.sql', 'index', 'email_failed_attempts_user_msg_uidx', null, 'public'),
  ('email_failed_attempts.sql', 'policy', 'email_failed_attempts_select_own', 'email_failed_attempts', 'public'),
  ('email_failed_attempts.sql', 'table', 'email_failed_attempts', null, 'public'),
  ('email_sender_rules.sql', 'index', 'email_sender_rules_user_email_uidx', null, 'public'),
  ('email_sender_rules.sql', 'policy', 'email_sender_rules_delete_own', 'email_sender_rules', 'public'),
  ('email_sender_rules.sql', 'policy', 'email_sender_rules_insert_own', 'email_sender_rules', 'public'),
  ('email_sender_rules.sql', 'policy', 'email_sender_rules_select_own', 'email_sender_rules', 'public'),
  ('email_sender_rules.sql', 'policy', 'email_sender_rules_update_own', 'email_sender_rules', 'public'),
  ('email_sender_rules.sql', 'table', 'email_sender_rules', null, 'public'),
  ('email_skipped_attachments_owner_read.sql', 'policy', 'owner reads own skipped attachments', 'email_skipped_attachments', 'public'),
  ('factuur_b_numbering.sql', 'column', 'invoice_number_padding', 'profiles', 'public'),
  ('factuur_b_numbering.sql', 'column', 'invoice_number_template', 'profiles', 'public'),
  ('factuur_b_numbering.sql', 'constraint', 'invoices_sender_invoice_number_key', null, 'public'),
  ('factuur_b_numbering.sql', 'function', 'next_invoice_seq', null, 'public'),
  ('factuur_b_numbering.sql', 'policy', 'invoice_counters_select_own', 'invoice_counters', 'public'),
  ('factuur_b_numbering.sql', 'table', 'invoice_counters', null, 'public'),
  ('fair_use_usage.sql', 'function', 'fair_use_consume', null, 'public'),
  ('fair_use_usage.sql', 'function', 'fair_use_release', null, 'public'),
  ('fair_use_usage.sql', 'index', 'usage_counters_period_idx', null, 'public'),
  ('fair_use_usage.sql', 'policy', 'usage_counters_select_own', 'usage_counters', 'public'),
  ('fair_use_usage.sql', 'table', 'usage_counters', null, 'public'),
  ('feedback.sql', 'index', 'feedback_user_created_idx', null, 'public'),
  ('feedback.sql', 'policy', 'feedback_insert_own', 'feedback', 'public'),
  ('feedback.sql', 'policy', 'feedback_select_own', 'feedback', 'public'),
  ('feedback.sql', 'table', 'feedback', null, 'public'),
  ('folders_accountant_read.sql', 'policy', 'folders_accountant_read', 'folders', 'public'),
  ('intake_claims.sql', 'index', 'uq_intake_claims_user_key', null, 'public'),
  ('intake_claims.sql', 'table', 'intake_claims', null, 'public'),
  ('invitations_rls_scoped_read.sql', 'policy', 'invitee or inviter can read invitations', 'invitations', 'public'),
  ('invoice_accountant_attribution.sql', 'column', 'accountant_id', 'invoices', 'public'),
  ('invoice_accountant_attribution.sql', 'function', 'accountant_status_door_only', null, 'public'),
  ('invoice_accountant_status_vocabulary.sql', 'constraint', 'invoices_accountant_status_check', null, 'public'),
  ('invoice_accountant_write_guard.sql', 'function_body', 'prevent_accountant_amount_changes', '.amount_paid,.btw_amount,.direction,.discount_type,.discount_value,.document_id,.due_date,.id,.invoice_date,.invoice_number,.invoice_type,.marked_paid_at,.pay_token,.payment_date,.payment_method,.payment_prepared_at,.payment_reference,.receiver_id,.sender_id,.status,.total_ex_btw,.total_inc_btw,.vat_deduction,.vendor_iban', 'public'),
  ('invoice_accountant_write_guard.sql', 'function_body', 'prevent_verwerkt_invoice_changes', '.accountant_status,.amount_paid,.btw_amount,.direction,.discount_type,.discount_value,.document_id,.due_date,.id,.invoice_date,.invoice_number,.invoice_type,.marked_paid_at,.pay_token,.payment_date,.payment_method,.payment_prepared_at,.payment_reference,.receiver_id,.sender_id,.status,.total_ex_btw,.total_inc_btw,.vat_deduction,.vendor_iban', 'public'),
  ('invoice_archive_reason.sql', 'column', 'archive_reason', 'invoices', 'public'),
  ('invoice_archive_reason.sql', 'column', 'archived_at', 'invoices', 'public'),
  ('invoice_archive_reason.sql', 'constraint', 'invoices_archive_reason_check', null, 'public'),
  ('invoice_archive_reason.sql', 'index', 'idx_invoices_archived_reason', null, 'public'),
  ('invoice_bijlage.sql', 'column', 'attachment_document_id', 'invoices', 'public'),
  ('invoice_bijlage.sql', 'constraint', 'invoices_attachment_document_id_fkey', null, 'public'),
  ('invoice_bijlage.sql', 'index', 'invoices_attachment_document_id_idx', null, 'public'),
  ('invoice_corrected_at.sql', 'column', 'corrected_at', 'invoices', 'public'),
  ('invoice_corrections.sql', 'index', 'invoice_corrections_accountant_idx', null, 'public'),
  ('invoice_corrections.sql', 'index', 'invoice_corrections_client_idx', null, 'public'),
  ('invoice_corrections.sql', 'index', 'invoice_corrections_open_uidx', null, 'public'),
  ('invoice_corrections.sql', 'policy', 'invoice_corrections_accountant_read', 'invoice_corrections', 'public'),
  ('invoice_corrections.sql', 'policy', 'invoice_corrections_client_read', 'invoice_corrections', 'public'),
  ('invoice_corrections.sql', 'table', 'invoice_corrections', null, 'public'),
  ('invoice_corrections_claim.sql', 'column', 'applying_since', 'invoice_corrections', 'public'),
  ('invoice_discount.sql', 'column', 'discount_type', 'invoices', 'public'),
  ('invoice_discount.sql', 'column', 'discount_value', 'invoices', 'public'),
  ('invoice_discount.sql', 'constraint', 'invoices_discount_pair_check', null, 'public'),
  ('invoice_discount.sql', 'constraint', 'invoices_discount_type_check', null, 'public'),
  ('invoice_discount.sql', 'constraint', 'invoices_discount_value_check', null, 'public'),
  ('invoice_line_discount.sql', 'column', 'discount_type', 'invoice_lines', 'public'),
  ('invoice_line_discount.sql', 'column', 'discount_value', 'invoice_lines', 'public'),
  ('invoice_line_discount.sql', 'constraint', 'invoice_lines_discount_type_check', null, 'public'),
  ('invoice_line_discount.sql', 'constraint', 'invoice_lines_discount_value_check', null, 'public'),
  ('invoice_line_unit.sql', 'column', 'unit', 'invoice_lines', 'public'),
  ('invoice_lines_accountant_gate.sql', 'policy', 'invoice_lines_select_accountant', 'invoice_lines', 'public'),
  ('invoice_manual_payment_idempotency_scope.sql', 'function_body', 'apply_manual_payment', 'different,idempotency,v_key_taken', 'public'),
  ('invoice_manual_payments.sql', 'column', 'client_key', 'bank_tx_invoices', 'public'),
  ('invoice_manual_payments.sql', 'column', 'method', 'bank_tx_invoices', 'public'),
  ('invoice_manual_payments.sql', 'column', 'paid_on', 'bank_tx_invoices', 'public'),
  ('invoice_manual_payments.sql', 'constraint', 'bank_tx_invoices_method_check', null, 'public'),
  ('invoice_manual_payments.sql', 'constraint', 'bank_tx_invoices_origin_check', null, 'public'),
  ('invoice_manual_payments.sql', 'function', 'apply_manual_payment', null, 'public'),
  ('invoice_move_payment.sql', 'function', 'move_invoice_payment', null, 'public'),
  ('invoice_move_payment_creditnota_guard.sql', 'function_body', 'move_invoice_payment', '[MOVE-PAYMENT],[VERPLAATS-TEKEN]', 'public'),
  ('invoice_number_twins.sql', 'function', 'invoice_number_twins', null, 'public'),
  ('invoice_paid_requires_allocation.sql', 'function', 'assert_paid_is_backed', null, 'public'),
  ('invoice_partial_payments.sql', 'column', 'amount_applied', 'bank_tx_invoices', 'public'),
  ('invoice_partial_payments.sql', 'column', 'amount_paid', 'invoices', 'public'),
  ('invoice_partial_payments.sql', 'function', 'apply_bank_payment', null, 'public'),
  ('invoice_partial_payments.sql', 'function', 'recompute_invoice_amount_paid', null, 'public'),
  ('invoice_payment_date_rederive.sql', 'function_body', 'recompute_invoice_amount_paid', 'bank_transactions,created_at,paid_on', 'public'),
  ('invoice_questions.sql', 'policy', 'acc_status_client_read_invoice', 'accountant_subject_status', 'public'),
  ('invoice_reminders.sql', 'column', 'reminder_offsets', 'profiles', 'public'),
  ('invoice_reminders.sql', 'column', 'reminders_enabled', 'profiles', 'public'),
  ('invoice_reminders.sql', 'column', 'reminders_paused', 'invoices', 'public'),
  ('invoice_reminders.sql', 'index', 'invoice_reminders_invoice_idx', null, 'public'),
  ('invoice_reminders.sql', 'index', 'invoice_reminders_user_idx', null, 'public'),
  ('invoice_reminders.sql', 'policy', 'invoice_reminders_select_own', 'invoice_reminders', 'public'),
  ('invoice_schedules.sql', 'column', 'schedule_id', 'invoices', 'public'),
  ('invoice_schedules.sql', 'index', 'idx_invoice_schedules_due', null, 'public'),
  ('invoice_schedules.sql', 'index', 'idx_invoice_schedules_user', null, 'public'),
  ('invoice_schedules.sql', 'index', 'invoice_schedules_one_per_source', null, 'public'),
  ('invoice_schedules.sql', 'index', 'invoices_one_per_schedule_date', null, 'public'),
  ('invoice_schedules.sql', 'policy', 'invoice_schedules_delete_own', 'invoice_schedules', 'public'),
  ('invoice_superseded_by.sql', 'column', 'superseded_by_number', 'invoices', 'public'),
  ('invoice_tax_kind.sql', 'column', 'tax_kind', 'invoices', 'public'),
  ('invoice_tax_kind.sql', 'constraint', 'invoices_tax_kind_known', null, 'public'),
  ('invoice_untaxed_amount.sql', 'column', 'untaxed_amount', 'invoices', 'public'),
  ('invoices_deposit.sql', 'column', 'deposit_on_offerte_id', 'invoices', 'public'),
  ('invoices_deposit.sql', 'index', 'invoices_deposit_on_offerte_idx', null, 'public'),
  ('invoices_first_viewed.sql', 'column', 'first_viewed_at', 'invoices', 'public'),
  ('invoices_ledger_account.sql', 'column', 'ledger_account', 'invoices', 'public'),
  ('invoices_ledger_account.sql', 'index', 'invoices_ledger_todo_idx', null, 'public'),
  ('kas_opening_balance.sql', 'column', 'kas_opening_balance', 'profiles', 'public'),
  ('kilometeradministratie.sql', 'index', 'idx_mileage_entries_invoice', null, 'public'),
  ('kilometeradministratie.sql', 'index', 'idx_mileage_entries_owner', null, 'public'),
  ('kilometeradministratie.sql', 'policy', 'mileage_entries_delete_own', 'mileage_entries', 'public'),
  ('kilometeradministratie.sql', 'policy', 'mileage_entries_insert_own', 'mileage_entries', 'public'),
  ('kilometeradministratie.sql', 'policy', 'mileage_entries_select_own', 'mileage_entries', 'public'),
  ('kilometeradministratie.sql', 'policy', 'mileage_entries_update_own', 'mileage_entries', 'public'),
  ('kluis_subscriptions.sql', 'index', 'kluis_subscriptions_session_uidx', null, 'public'),
  ('kluis_subscriptions.sql', 'index', 'kluis_subscriptions_user_idx', null, 'public'),
  ('kluis_subscriptions.sql', 'policy', 'kluis_subscriptions_select_own', 'kluis_subscriptions', 'public'),
  ('kluis_subscriptions.sql', 'table', 'kluis_subscriptions', null, 'public'),
  ('ledger_daily.sql', 'index', 'idx_ledger_daily_user_date', null, 'public'),
  ('ledger_daily.sql', 'index', 'ledger_daily_unique_day_kind', null, 'public'),
  ('ledger_daily.sql', 'policy', 'ledger_daily_delete_own', 'ledger_daily', 'public'),
  ('ledger_daily.sql', 'policy', 'ledger_daily_insert_own', 'ledger_daily', 'public'),
  ('ledger_daily.sql', 'policy', 'ledger_daily_select_own', 'ledger_daily', 'public'),
  ('ledger_daily.sql', 'policy', 'ledger_daily_update_own', 'ledger_daily', 'public'),
  ('mollie.sql', 'index', 'mollie_payment_links_open_uidx', null, 'public'),
  ('mollie.sql', 'index', 'mollie_payment_links_user_created_idx', null, 'public'),
  ('mollie.sql', 'policy', 'mollie_connections_select_own', 'mollie_connections', 'public'),
  ('mollie.sql', 'table', 'mollie_connections', null, 'public'),
  ('mollie.sql', 'table', 'mollie_payment_links', null, 'public'),
  ('mollie_settlements.sql', 'column', 'payment_id', 'mollie_payment_links', 'public'),
  ('mollie_settlements.sql', 'index', 'mollie_payment_links_payment_idx', null, 'public'),
  ('mollie_settlements.sql', 'index', 'mollie_settlements_user_settled_idx', null, 'public'),
  ('mollie_settlements.sql', 'policy', 'mollie_settlements_select_own', 'mollie_settlements', 'public'),
  ('mollie_settlements.sql', 'table', 'mollie_settlements', null, 'public'),
  ('mollie_settlements_fee_paid.sql', 'column', 'fee_paid_at', 'mollie_settlements', 'public'),
  ('ochtend_mail.sql', 'column', 'ochtend_mail', 'profiles', 'public'),
  ('offerte_akkoord.sql', 'column', 'offerte_responded_at', 'invoices', 'public'),
  ('offerte_akkoord.sql', 'column', 'offerte_response', 'invoices', 'public'),
  ('offerte_akkoord.sql', 'column', 'offerte_response_name', 'invoices', 'public'),
  ('offerte_akkoord.sql', 'column', 'offerte_token', 'invoices', 'public'),
  ('offerte_akkoord.sql', 'constraint', 'invoices_offerte_response_check', null, 'public'),
  ('offerte_akkoord.sql', 'constraint', 'invoices_offerte_response_paired_check', null, 'public'),
  ('ontvangen_intake_intent.sql', 'column', 'duplicate_candidate_invoice_id', 'documents', 'public'),
  ('ontvangen_intake_intent.sql', 'column', 'duplicate_decision', 'documents', 'public'),
  ('ontvangen_intake_intent.sql', 'column', 'intake_paid_date', 'documents', 'public'),
  ('ontvangen_intake_intent.sql', 'column', 'intake_paid_method', 'documents', 'public'),
  ('ontvangen_intake_intent.sql', 'constraint', 'documents_duplicate_decision_check', null, 'public'),
  ('ontvangen_intake_intent.sql', 'constraint', 'documents_intake_paid_method_check', null, 'public'),
  ('package_deliveries.sql', 'index', 'package_deliveries_quarter_idx', null, 'public'),
  ('package_deliveries.sql', 'policy', 'package_deliveries_select_own', 'package_deliveries', 'public'),
  ('package_deliveries.sql', 'table', 'package_deliveries', null, 'public'),
  ('package_shares.sql', 'index', 'idx_package_shares_user', null, 'public'),
  ('package_shares.sql', 'policy', 'package_shares_insert_own', 'package_shares', 'public'),
  ('package_shares.sql', 'policy', 'package_shares_select_own', 'package_shares', 'public'),
  ('package_shares.sql', 'policy', 'package_shares_update_own', 'package_shares', 'public'),
  ('package_shares.sql', 'table', 'package_shares', null, 'public'),
  ('paid_invoice_money_frozen.sql', 'function', 'prevent_paid_invoice_rewrite', null, 'public'),
  ('pay_bundles.sql', 'index', 'idx_pay_bundle_invoices_bundle', null, 'public'),
  ('pay_bundles.sql', 'index', 'idx_pay_bundle_invoices_invoice', null, 'public'),
  ('pay_bundles.sql', 'index', 'idx_pay_bundles_token', null, 'public'),
  ('pay_bundles.sql', 'index', 'idx_pay_bundles_user', null, 'public'),
  ('pay_bundles.sql', 'index', 'pay_bundle_invoices_unique_pair', null, 'public'),
  ('pay_bundles.sql', 'policy', 'pay_bundle_invoices_delete_own', 'pay_bundle_invoices', 'public'),
  ('plan_grants.sql', 'function', 'grant_welcome_plus', null, 'public'),
  ('plan_grants.sql', 'index', 'plan_grants_active_idx', null, 'public'),
  ('plan_grants.sql', 'policy', 'plan_grants_own_read', 'plan_grants', 'public'),
  ('plan_grants.sql', 'table', 'plan_grants', null, 'public'),
  ('profile_vak.sql', 'function_body', 'handle_new_user', '.email,.id,.raw_user_meta_data', 'public'),
  ('profile_vak.sql', 'column', 'vak', 'profiles', 'public'),
  ('push_subscriptions.sql', 'index', 'idx_push_subscriptions_user', null, 'public'),
  ('push_subscriptions.sql', 'policy', 'push_subscriptions_delete_own', 'push_subscriptions', 'public'),
  ('push_subscriptions.sql', 'policy', 'push_subscriptions_select_own', 'push_subscriptions', 'public'),
  ('push_subscriptions.sql', 'table', 'push_subscriptions', null, 'public'),
  ('readiness_cache.sql', 'index', 'readiness_cache_quarter_idx', null, 'public'),
  ('readiness_cache.sql', 'table', 'readiness_cache', null, 'public'),
  ('regime_kor.sql', 'column', 'kor_active', 'profiles', 'public'),
  ('register_profile_from_metadata.sql', 'function_body', 'handle_new_user', '.email,.id,.raw_user_meta_data', 'public'),
  ('reminders_on_by_default.sql', 'column', 'reminders_enabled_at', 'profiles', 'public'),
  ('repair_mandate_policies.sql', 'column', 'purge_warning_sent_at', 'deletion_requests', 'public'),
  ('repair_mandate_policies.sql', 'index', 'deletion_requests_unwarned_idx', null, 'public'),
  ('repair_mandate_policies.sql', 'policy', 'invoice_lines_mandate_read', 'invoice_lines', 'public'),
  ('repair_mandate_policies.sql', 'policy', 'invoices_mandate_draft_issue', 'invoices', 'public'),
  ('repair_mandate_policies.sql', 'policy', 'invoices_mandate_draft_read', 'invoices', 'public'),
  ('retention_purge.sql', 'column', 'purged_at', 'deletion_requests', 'public'),
  ('retention_purge.sql', 'index', 'deletion_requests_purge_due_idx', null, 'public'),
  ('search_bank_cash.sql', 'index', 'bank_transactions_counterpart_iban_trgm', null, 'public'),
  ('search_bank_cash.sql', 'index', 'bank_transactions_counterpart_name_trgm', null, 'public'),
  ('search_bank_cash.sql', 'index', 'bank_transactions_description_trgm', null, 'public'),
  ('search_bank_cash.sql', 'index', 'bank_transactions_reference_trgm', null, 'public'),
  ('search_bank_cash.sql', 'index', 'cash_entries_category_trgm', null, 'public'),
  ('search_bank_cash.sql', 'index', 'cash_entries_description_trgm', null, 'public'),
  ('search_engine.sql', 'index', 'clients_email_trgm', null, 'public'),
  ('search_engine.sql', 'index', 'clients_name_trgm', null, 'public'),
  ('search_engine.sql', 'index', 'documents_ai_doc_type_trgm', null, 'public'),
  ('search_engine.sql', 'index', 'documents_doc_type_trgm', null, 'public'),
  ('search_engine.sql', 'index', 'documents_file_name_trgm', null, 'public'),
  ('search_engine.sql', 'index', 'documents_notes_trgm', null, 'public'),
  ('search_engine_clients_kvk_city.sql', 'index', 'clients_city_trgm', null, 'public'),
  ('search_engine_clients_kvk_city.sql', 'index', 'clients_kvk_number_trgm', null, 'public'),
  ('search_smart.sql', 'function', 'search_clients_fuzzy', null, 'public'),
  ('search_smart.sql', 'function', 'search_documents_fuzzy', null, 'public'),
  ('search_smart.sql', 'function', 'search_folders_fuzzy', null, 'public'),
  ('search_smart.sql', 'function', 'search_invoices_fuzzy', null, 'public'),
  ('seed_invoice_counter.sql', 'function', 'seed_invoice_counter', null, 'public'),
  ('snelstart_claim_before_push.sql', 'constraint', 'snelstart_exports_status_check', null, 'public'),
  ('snelstart_claim_before_push.sql', 'index', 'snelstart_exports_user_invoice_claim_uidx', null, 'public'),
  ('snelstart_connection.sql', 'index', 'snelstart_exports_user_pushed_at_idx', null, 'public'),
  ('snelstart_connection.sql', 'policy', 'snelstart_connections_select_own', 'snelstart_connections', 'public'),
  ('snelstart_connection.sql', 'policy', 'snelstart_exports_select_own', 'snelstart_exports', 'public'),
  ('snelstart_connection.sql', 'table', 'snelstart_connections', null, 'public'),
  ('snelstart_connection.sql', 'table', 'snelstart_exports', null, 'public'),
  ('subscription_plans_fair_use.sql', 'constraint', 'profiles_subscription_plan_check', null, 'public'),
  ('supplier_aliases.sql', 'index', 'idx_supplier_aliases_supplier', null, 'public'),
  ('supplier_aliases.sql', 'index', 'supplier_aliases_unique_key', null, 'public'),
  ('supplier_aliases.sql', 'policy', 'supplier_aliases_delete_own', 'supplier_aliases', 'public'),
  ('supplier_aliases.sql', 'policy', 'supplier_aliases_insert_own', 'supplier_aliases', 'public'),
  ('supplier_aliases.sql', 'policy', 'supplier_aliases_select_own', 'supplier_aliases', 'public'),
  ('supplier_aliases.sql', 'policy', 'supplier_aliases_update_own', 'supplier_aliases', 'public'),
  ('supplier_country.sql', 'column', 'country', 'suppliers', 'public'),
  ('supplier_defaults.sql', 'column', 'default_btw_rate', 'suppliers', 'public'),
  ('supplier_defaults.sql', 'column', 'default_category', 'suppliers', 'public'),
  ('supplier_defaults.sql', 'constraint', 'suppliers_default_btw_rate_legal', null, 'public'),
  ('supplier_defaults.sql', 'constraint', 'suppliers_default_category_known', null, 'public'),
  ('supplier_edit.sql', 'index', 'supplier_iban_history_supplier_idx', null, 'public'),
  ('supplier_edit.sql', 'index', 'supplier_iban_history_user_iban_idx', null, 'public'),
  ('supplier_edit.sql', 'policy', 'supplier_iban_history_insert_own', 'supplier_iban_history', 'public'),
  ('supplier_edit.sql', 'policy', 'supplier_iban_history_select_own', 'supplier_iban_history', 'public'),
  ('supplier_edit.sql', 'table', 'supplier_iban_history', null, 'public'),
  ('supplier_kvk_index.sql', 'index', 'suppliers_user_kvk_uidx', null, 'public'),
  ('supplier_registry.sql', 'column', 'supplier_id', 'invoices', 'public'),
  ('supplier_registry.sql', 'index', 'idx_invoices_supplier_id', null, 'public'),
  ('supplier_registry.sql', 'index', 'suppliers_name_trgm', null, 'public'),
  ('supplier_registry.sql', 'index', 'suppliers_user_iban_uidx', null, 'public'),
  ('supplier_registry.sql', 'index', 'suppliers_user_name_key_idx', null, 'public'),
  ('supplier_registry.sql', 'policy', 'suppliers_delete_own', 'suppliers', 'public'),
  ('system_events.sql', 'index', 'system_events_at_idx', null, 'public'),
  ('system_events.sql', 'table', 'system_events', null, 'public'),
  ('till_sales.sql', 'index', 'idx_till_sales_ticket', null, 'public'),
  ('till_sales.sql', 'index', 'idx_till_sales_user_date', null, 'public'),
  ('till_sales.sql', 'policy', 'till_sales_delete_own', 'till_sales', 'public'),
  ('till_sales.sql', 'policy', 'till_sales_insert_own', 'till_sales', 'public'),
  ('till_sales.sql', 'policy', 'till_sales_select_own', 'till_sales', 'public'),
  ('till_sales.sql', 'policy', 'till_sales_update_own', 'till_sales', 'public'),
  ('time_entries_declarabel.sql', 'column', 'billable', 'time_entries', 'public'),
  ('time_entries_declarabel.sql', 'index', 'time_entries_billable_open_idx', null, 'public'),
  ('urenregistratie.sql', 'index', 'idx_time_entries_invoice', null, 'public'),
  ('urenregistratie.sql', 'index', 'idx_time_entries_unbilled', null, 'public'),
  ('urenregistratie.sql', 'policy', 'time_entries_delete_own', 'time_entries', 'public'),
  ('urenregistratie.sql', 'policy', 'time_entries_insert_own', 'time_entries', 'public'),
  ('urenregistratie.sql', 'policy', 'time_entries_select_own', 'time_entries', 'public'),
  ('urenregistratie.sql', 'policy', 'time_entries_update_own', 'time_entries', 'public'),
  ('usage_counters_internal_metrics.sql', 'policy', 'usage_counters_select_own', 'usage_counters', 'public'),
  ('vat_exemption.sql', 'constraint_def', 'invoice_lines_vat_treatment_check', 'exempt,taxed', 'public'),
  ('vat_exemption.sql', 'function_body', 'prevent_accountant_amount_changes', '.amount_paid,.btw_amount,.direction,.discount_type,.discount_value,.document_id,.due_date,.id,.invoice_date,.invoice_number,.invoice_type,.marked_paid_at,.pay_token,.payment_date,.payment_method,.payment_prepared_at,.payment_reference,.receiver_id,.sender_id,.status,.total_ex_btw,.total_inc_btw,.vat_deduction,.vendor_iban', 'public'),
  ('vat_exemption.sql', 'column', 'vat_deduction', 'invoices', 'public'),
  ('vat_exemption.sql', 'column', 'vat_exempt_activity', 'profiles', 'public'),
  ('vat_exemption.sql', 'column', 'vat_exempt_since', 'profiles', 'public'),
  ('vat_exemption.sql', 'column', 'vat_treatment', 'invoice_lines', 'public'),
  ('vat_reverse_charge.sql', 'constraint_def', 'invoice_lines_vat_treatment_check', 'exempt,reverse_charge,taxed', 'public'),
  ('vat_scheme.sql', 'column', 'vat_scheme', 'profiles', 'public'),
  ('vat_scheme.sql', 'column', 'vat_scheme_since', 'profiles', 'public'),
  ('vat_statement_note.sql', 'column', 'vat_statement_note', 'profiles', 'public'),
  ('vehicles.sql', 'index', 'idx_vehicles_user_apk', null, 'public'),
  ('vehicles.sql', 'policy', 'vehicles_delete_own', 'vehicles', 'public'),
  ('vehicles.sql', 'policy', 'vehicles_insert_own', 'vehicles', 'public'),
  ('vehicles.sql', 'policy', 'vehicles_select_own', 'vehicles', 'public'),
  ('vehicles.sql', 'policy', 'vehicles_update_own', 'vehicles', 'public'),
  ('vehicles.sql', 'table', 'vehicles', null, 'public'),
  ('verwerkt_freeze_level.sql', 'function_body', 'prevent_verwerkt_invoice_changes', '.accountant_status,.amount_paid,.btw_amount,.direction,.discount_type,.discount_value,.document_id,.due_date,.id,.invoice_date,.invoice_number,.invoice_type,.marked_paid_at,.pay_token,.payment_date,.payment_method,.payment_prepared_at,.payment_reference,.receiver_id,.sender_id,.status,.total_ex_btw,.total_inc_btw,.vat_deduction,.vendor_iban', 'public'),
  ('wachtkoppelingen.sql', 'index', 'wachtkoppelingen_open_idx', null, 'public'),
  ('wachtkoppelingen.sql', 'index', 'wachtkoppelingen_tx_idx', null, 'public'),
  ('wachtkoppelingen.sql', 'policy', 'wachtkoppelingen_owner_read', 'wachtkoppelingen', 'public'),
  ('wachtkoppelingen.sql', 'policy', 'wachtkoppelingen_owner_update', 'wachtkoppelingen', 'public'),
  ('wachtkoppelingen.sql', 'policy', 'wachtkoppelingen_owner_write', 'wachtkoppelingen', 'public'),
  ('wachtkoppelingen.sql', 'table', 'wachtkoppelingen', null, 'public'),
  ('work_done_counts.sql', 'function', 'work_done_counts', null, 'public'),
  ('work_items.sql', 'column', 'lines', 'work_items', 'public'),
  ('work_items.sql', 'column', 'work_item_id', 'invoices', 'public'),
  ('work_items.sql', 'column', 'work_item_id', 'time_entries', 'public'),
  ('work_items.sql', 'column', 'work_item_id', 'documents', 'public'),
  ('work_items.sql', 'index', 'idx_documents_work_item', null, 'public'),
  ('work_items.sql', 'index', 'idx_invoices_work_item', null, 'public'),
  ('work_items_offerte.sql', 'column', 'offerte_id', 'work_items', 'public'),
  ('work_items_offerte.sql', 'index', 'work_items_offerte_once_idx', null, 'public'),
  ('work_items_periods.sql', 'column', 'billed_periods', 'work_items', 'public'),
  ('work_items_repeat.sql', 'column', 'repeat_every', 'work_items', 'public'),
  ('work_items_repeat.sql', 'column', 'visits', 'work_items', 'public'),
  ('work_items_repeat_kwartaal.sql', 'constraint', 'work_items_repeat_every_check', null, 'public')
),
bevonden as (
  select p.*,
    case p.soort
      when 'table' then exists (select 1 from information_schema.tables
             where table_schema = p.schema and table_name = p.object)
      when 'column' then exists (select 1 from information_schema.columns
             where table_schema = p.schema and table_name = p.tabel and column_name = p.object)
      when 'function' then exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
             where n.nspname = p.schema and f.proname = p.object)
      -- Een functie die meer dan één migratie herschrijft: haar BESTAAN bewijst alleen dat
      -- de eerste van die migraties gedraaid heeft. Gemeten wordt daarom de body — elke
      -- kolomverwijzing die de map unaniem in deze functie verwacht, moet erin staan.
      when 'function_body' then exists (
             select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
             where n.nspname = p.schema and f.proname = p.object
               and not exists (select 1 from unnest(string_to_array(p.tabel, ',')) mk
                               where position(mk in f.prosrc) = 0))
      when 'index' then exists (select 1 from pg_indexes
             where schemaname = p.schema and indexname = p.object)
      when 'constraint' then exists (select 1 from pg_constraint where conname = p.object)
      -- Een constraint die meer dan één migratie onder dezelfde naam schrijft: haar BESTAAN
      -- bewijst alleen de eerste. Gemeten wordt de definitie — elke waarde die dit bestand
      -- zelf in de CHECK noemt, moet erin staan.
      when 'constraint_def' then exists (
             select 1 from pg_constraint c where c.conname = p.object
               and not exists (select 1 from unnest(string_to_array(p.tabel, ',')) mk
                               where position(quote_literal(mk) in pg_get_constraintdef(c.oid)) = 0))
      -- Een policy staat lang niet altijd in public: de bestandspolicies zitten op
      -- storage.objects. Op het verkeerde schema zoeken gaf een alarm dat nooit uitging.
      when 'policy' then exists (select 1 from pg_policies
             where schemaname = p.schema and tablename = p.tabel and policyname = p.object)
    end as aanwezig
  from probe p
)
select
  case when bool_and(aanwezig) then 'TOEGEPAST'
       when bool_or(aanwezig)  then 'GEDEELTELIJK  <-- KIJK HIER'
       else 'OPEN' end                                        as stand,
  bestand,
  count(*) filter (where aanwezig) || ' / ' || count(*)       as objecten_gevonden,
  string_agg(case when not aanwezig then
    case when soort = 'function_body'
         then 'function ' || schema || '.' || object || ' loopt achter op de map (mist een van: ' || tabel || ')'
         when soort = 'constraint_def'
         then 'constraint ' || object || ' loopt achter op de map (mist een van: ' || tabel || ')'
         else soort || ' ' || schema || '.' || object end end, ', ')                as ontbreekt
from bevonden
group by bestand
-- GEDEELTELIJK eerst, dan OPEN, dan de rest: de regels waar iets aan te doen is, bovenaan.
order by case when bool_and(aanwezig) then 3 when bool_or(aanwezig) then 1 else 2 end, bestand;

-- ── WAT DEEL 1 OVER DEZE FUNCTIES WÉL EN NIET ZEGT ──────────────────
--
--   12 functies worden door meer dan één migratie geschreven. Voor die functies zegt TOEGEPAST: de
--   body in de database bevat elke kolomverwijzing die de map er unaniem in verwacht. Het zegt NIET
--   welk van die bestanden hem daar gezet heeft — en dat is niet vast te stellen, want een CREATE OR
--   REPLACE laat geen spoor van zijn herkomst achter. OPEN betekent hier dus: de functie in de
--   database loopt achter op de map, en de migraties hieronder zijn samen het antwoord.
--
--   allocate_bank_payment
--     · allocate_bank_payment.sql
--     · bank_rpc_never_payable_states.sql
--     GEEN INHOUDSMETING: deze definities delen geen enkele NEW./OLD.-kolomverwijzing, dus er is
--     niets dat de map unaniem in deze functie verwacht. Deel 1 valt hier terug op het bestaan van
--     de functie, en dat bewijst alleen dat de EERSTE van deze migraties gedraaid heeft.
--
--   apply_bank_payment
--     · bank_rpc_never_payable_states.sql
--     · invoice_partial_payments.sql
--     GEEN INHOUDSMETING: deze definities delen geen enkele NEW./OLD.-kolomverwijzing, dus er is
--     niets dat de map unaniem in deze functie verwacht. Deel 1 valt hier terug op het bestaan van
--     de functie, en dat bewijst alleen dat de EERSTE van deze migraties gedraaid heeft.
--
--   apply_manual_payment
--     · invoice_manual_payment_idempotency_scope.sql
--     · invoice_manual_payments.sql
--     GEEN INHOUDSMETING: deze definities delen geen enkele NEW./OLD.-kolomverwijzing, dus er is
--     niets dat de map unaniem in deze functie verwacht. Deel 1 valt hier terug op het bestaan van
--     de functie, en dat bewijst alleen dat de EERSTE van deze migraties gedraaid heeft.
--
--   book_bank_batch
--     · bank_confirm_atomic.sql
--     · book_bank_batch_atomic.sql
--     GEEN INHOUDSMETING: deze definities delen geen enkele NEW./OLD.-kolomverwijzing, dus er is
--     niets dat de map unaniem in deze functie verwacht. Deel 1 valt hier terug op het bestaan van
--     de functie, en dat bewijst alleen dat de EERSTE van deze migraties gedraaid heeft.
--
--   confirm_bank_payment
--     · bank_confirm_atomic.sql
--     · bank_rpc_never_payable_states.sql
--     GEEN INHOUDSMETING: deze definities delen geen enkele NEW./OLD.-kolomverwijzing, dus er is
--     niets dat de map unaniem in deze functie verwacht. Deel 1 valt hier terug op het bestaan van
--     de functie, en dat bewijst alleen dat de EERSTE van deze migraties gedraaid heeft.
--
--   handle_new_user
--     · account_purpose_archief.sql
--     · profile_vak.sql
--     · register_profile_from_metadata.sql
--
--   has_active_invoice_mandate
--     · accountant_confirm_mandate.sql
--     · accountant_invoice_mandate.sql
--     GEEN INHOUDSMETING: deze definities delen geen enkele NEW./OLD.-kolomverwijzing, dus er is
--     niets dat de map unaniem in deze functie verwacht. Deel 1 valt hier terug op het bestaan van
--     de functie, en dat bewijst alleen dat de EERSTE van deze migraties gedraaid heeft.
--
--   move_invoice_payment
--     · invoice_move_payment.sql
--     · invoice_move_payment_creditnota_guard.sql
--     GEEN INHOUDSMETING: deze definities delen geen enkele NEW./OLD.-kolomverwijzing, dus er is
--     niets dat de map unaniem in deze functie verwacht. Deel 1 valt hier terug op het bestaan van
--     de functie, en dat bewijst alleen dat de EERSTE van deze migraties gedraaid heeft.
--
--   next_invoice_seq
--     · accountant_invoice_mandate.sql
--     · company_members_sales_role.sql
--     · factuur_b_numbering.sql
--     GEEN INHOUDSMETING: deze definities delen geen enkele NEW./OLD.-kolomverwijzing, dus er is
--     niets dat de map unaniem in deze functie verwacht. Deel 1 valt hier terug op het bestaan van
--     de functie, en dat bewijst alleen dat de EERSTE van deze migraties gedraaid heeft.
--
--   prevent_accountant_amount_changes
--     · accountant_amount_guard_restore.sql
--     · accountant_confirm_mandate.sql
--     · accountant_discount_guard.sql
--     · accountant_invoice_mandate.sql
--     · accountant_vat_deduction_guard.sql
--     · accountant_write_guard_fix.sql
--     · accountant_write_holes.sql
--     · invoice_accountant_write_guard.sql
--     · vat_exemption.sql
--
--   prevent_verwerkt_invoice_changes
--     · invoice_accountant_write_guard.sql
--     · verwerkt_freeze_level.sql
--
--   recompute_invoice_amount_paid
--     · invoice_partial_payments.sql
--     · invoice_payment_date_rederive.sql
--     GEEN INHOUDSMETING: deze definities delen geen enkele NEW./OLD.-kolomverwijzing, dus er is
--     niets dat de map unaniem in deze functie verwacht. Deel 1 valt hier terug op het bestaan van
--     de functie, en dat bewijst alleen dat de EERSTE van deze migraties gedraaid heeft.
--

-- =====================================================================
-- DEEL 2 — NIET VAST TE STELLEN MET EEN OBJECT: 19 van de 177
-- =====================================================================
--
-- Deze trekken alleen rechten in, gooien iets weg, zetten een stand goed of verplaatsen
-- data. Er is geen object waarvan het BESTAAN iets bewijst, dus de query hierboven kan er
-- niets over zeggen — ze krijgen met opzet GEEN verzonnen vingerafdruk.
--
-- Wat hieronder wordt gemeten is niet het bestaan van een object maar de STAND: is de
-- policy weg, is de kolom weg, staat de bucket privé, is het recht ingetrokken. Draai de
-- query net als de eerste: als service_role, in de SQL-editor. Ze verandert niets.
--
-- De vragen staan in STAND_CONTROLE in scripts/migration-inventory.ts. Een migratie zonder
-- vingerafdruk die daar niet in staat, laat de generator vallen — ontbreken kan dus niet.
--
with controle(bestand, vraag, toegepast) as (
  select 'BRIDGE-D_soft_delete_test_pollution.sql'::text, 'de zes testdocumenten staan in de prullenbak'::text, (
    not exists (
    select 1 from public.documents
     where id in ('45a026eb-59bd-4349-ac10-8251b820978e',
                  '4ba6a60d-f1d9-4bbc-8083-53a1d78b867c',
                  '8cdccc7b-86c2-4d74-ac54-eb5c416caa06',
                  'd2f6abf1-866f-4daa-8862-4c1bfee8fd7f',
                  'e06eaa4e-5f20-4a89-9621-32b821b2bf3f',
                  'f15a973a-30d1-4404-bff0-6d4eade2c93d')
       and trashed is not true)
  )
  union all
  select 'accountant_clients_insert_consent.sql'::text, 'de oude insert-policy is weg — een boekhouder koppelt zichzelf niet meer aan een klant'::text, (
    not exists (select 1 from pg_policies
    where schemaname = 'public' and tablename = 'accountant_clients'
      and policyname = 'accountant_clients_insert')
  )
  union all
  select 'accountant_clients_update_consent.sql'::text, 'de oude update-policy is weg'::text, (
    not exists (select 1 from pg_policies
    where schemaname = 'public' and tablename = 'accountant_clients'
      and policyname = 'accountant_clients_update')
  )
  union all
  select 'accountant_guard_fixed_search_path.sql'::text, 'de bedragbewaker draait met een vast zoekpad'::text, (
    exists (select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'prevent_accountant_amount_changes'
      and 'search_path=public' = any(p.proconfig))
  )
  union all
  select 'anon_mandate_oracle_revoke.sql'::text, 'anon kan de drie machtigings-/eigendomsvragen niet meer stellen — en de klantcheck die {public}-policies nodig hebben staat er nog wél'::text, (
    not has_function_privilege('anon', 'public.has_active_invoice_mandate(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.has_active_confirm_mandate(uuid,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.audit_row_is_about_me(text,uuid,uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.has_active_invoice_mandate(uuid,uuid)', 'EXECUTE')
    and has_function_privilege('anon', 'public.is_my_accountant_client(uuid)', 'EXECUTE')
  )
  union all
  select 'bank_transactions_column_grant.sql'::text, 'authenticated mag op bank_transactions nog precies de drie categorie-kolommen UPDATEN en geen enkele regel meer verwijderen'::text, (
    (select count(*) from information_schema.column_privileges
       where table_schema = 'public' and table_name = 'bank_transactions'
         and grantee = 'authenticated' and privilege_type = 'UPDATE') = 3
    and not exists (
      select 1 from information_schema.column_privileges
       where table_schema = 'public' and table_name = 'bank_transactions'
         and grantee = 'authenticated' and privilege_type = 'UPDATE'
         and column_name not in ('category', 'category_source', 'category_confirmed'))
    and not exists (
      select 1 from pg_policy
       where polrelid = 'public.bank_transactions'::regclass and polcmd = 'd')
  )
  union all
  select 'bank_tx_invoices_amount.sql'::text, 'de dubbele kolom `amount` is weg en `amount_applied` staat er'::text, (
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'bank_tx_invoices'
               and column_name = 'amount_applied')
    and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'bank_tx_invoices'
                       and column_name = 'amount')
  )
  union all
  select 'confirm_bank_payment_regrant.sql'::text, 'confirm_bank_payment is weer aan te roepen door authenticated, en nog steeds niet door anon'::text, (
    exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'confirm_bank_payment'
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
       and not has_function_privilege('anon', p.oid, 'EXECUTE'))
  )
  union all
  select 'drop_duplicate_indexes.sql'::text, 'geen twee indexen meer met precies dezelfde vorm op dezelfde tabel'::text, (
    not exists (
    select 1
      from (select i.indrelid, i.indisunique,
                   regexp_replace(pg_get_indexdef(i.indexrelid), '^CREATE (UNIQUE )?INDEX \S+ ', '') as vorm
              from pg_index i
              join pg_class c on c.oid = i.indexrelid
              join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public') d
     group by indrelid, indisunique, vorm
    having count(*) > 1)
  )
  union all
  select 'drop_supplier_rows_that_are_misreadings.sql'::text, 'geen leveranciersrij houdt nog een nummer vast dat geen rekeningnummer is terwijl niets ernaar wijst'::text, (
    not exists (
    with schoon as (
      select s.id, upper(regexp_replace(s.iban, '[^A-Za-z0-9]', '', 'g')) as c
        from public.suppliers s where s.iban is not null
    ), cijfers as (
      select h.id, h.c,
             string_agg(case when t.ch ~ '^[0-9]$' then t.ch else (ascii(t.ch) - 55)::text end,
                        '' order by t.ord) as n
        from (select id, c, substr(c, 5) || substr(c, 1, 4) as r from schoon) h,
             lateral regexp_split_to_table(h.r, '') with ordinality as t(ch, ord)
       group by h.id, h.c
    )
    select 1 from cijfers v
     where not (length(v.c) = 18 and v.n ~ '^[0-9]+$' and mod(v.n::numeric, 97) = 1)
       and not exists (select 1 from public.invoices i where i.supplier_id = v.id)
       and not exists (select 1 from public.supplier_aliases a where a.supplier_id = v.id))
  )
  union all
  select 'function_search_path.sql'::text, 'elk van de negen functies heeft een vastgezet search_path'::text, (
    not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('prevent_billing_self_grant', 'prevent_accountant_amount_changes',
                         'prevent_verwerkt_invoice_changes', 'guard_paid_when_verwerkt',
                         'invoices_search_vector_update', 'documents_search_vector_update',
                         'set_updated_at', 'touch_updated_at', 'get_accountant_for_zzper')
       and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=%')
  )
  union all
  select 'invoice_name_follows_taught_supplier.sql'::text, 'geen factuur toont nog een spelling die de eigenaar zelf aan zijn leverancier koppelde'::text, (
    not exists (
    select 1
      from public.invoices i
      join public.suppliers s on s.id = i.supplier_id
      join public.supplier_aliases a
        on a.user_id = i.receiver_id
       and a.supplier_id = i.supplier_id
       and lower(btrim(a.printed_name)) = lower(btrim(i.client_name))
     where i.client_name is not null
       and lower(btrim(i.client_name)) is distinct from lower(btrim(s.name)))
  )
  union all
  select 'revoke_execute_on_trigger_functions.sql'::text, 'geen enkele triggerbewaker hangt nog als /rest/v1/rpc aan de buitenkant'::text, (
    not exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('assert_credit_within_rate', 'prevent_verwerkt_invoice_changes',
                         'prevent_accountant_amount_changes', 'guard_paid_when_verwerkt',
                         'assert_bookkeeping_date_sane', 'invoices_search_vector_update')
       and (p.proacl is null
            or exists (select 1 from aclexplode(p.proacl) a
                        where a.grantee in ('anon'::regrole, 'authenticated'::regrole, 0))))
  )
  union all
  select 'rls_initplan_wrap_auth_calls.sql'::text, 'geen policy roept auth.uid() nog per rij aan, en geen enkele is dubbel gewikkeld'::text, (
    not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and ( (coalesce(qual,'')       like '%auth.uid()%' and coalesce(qual,'')       not like '%SELECT auth.uid()%')
          or (coalesce(with_check,'') like '%auth.uid()%' and coalesce(with_check,'') not like '%SELECT auth.uid()%')
          or coalesce(qual,'')       like '%SELECT ( SELECT auth.%'
          or coalesce(with_check,'') like '%SELECT ( SELECT auth.%' ))
  )
  union all
  select 'rpc_anon_revoke.sql'::text, 'geen enkele geldfunctie is nog aan te roepen door anon, en zes ook niet door authenticated'::text, (
    not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('seed_invoice_counter', 'next_invoice_seq', 'apply_manual_payment', 'apply_bank_payment', 'allocate_bank_payment', 'confirm_bank_payment', 'book_bank_batch', 'move_invoice_payment', 'recompute_invoice_amount_paid', 'fair_use_consume', 'fair_use_release', 'handle_new_user', 'assert_credit_within_original')
        and has_function_privilege('anon', p.oid, 'EXECUTE'))
    and not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('seed_invoice_counter', 'recompute_invoice_amount_paid', 'fair_use_consume', 'fair_use_release', 'handle_new_user', 'assert_credit_within_original')
        and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  )
  union all
  select 'storage_bucket_hardening.sql'::text, 'de documentenbucket staat privé, met een limiet van 25 MB en RLS aan'::text, (
    exists (select 1 from storage.buckets
             where id = 'documents' and public is false
               and file_size_limit is not null and file_size_limit <= 26214400)
    and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity)
  )
  union all
  select 'welcome_grant_retired.sql'::text, 'de welkomsttrigger staat niet meer op profiles, terwijl de functie die hij aanriep er nog wél is'::text, (
    not exists (
     select 1 from pg_trigger
      where tgrelid = 'public.profiles'::regclass
        and tgname = 'profiles_welcome_plus' and not tgisinternal)
    and exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'grant_welcome_plus')
  )
)
select case when toegepast then 'TOEGEPAST' else 'OPEN  <-- KIJK HIER' end as stand,
       bestand, vraag
  from controle
 order by toegepast, bestand;

-- =====================================================================
-- ZELF LEZEN — geen oordeel, want een uitkomst hier kan ook een andere oorzaak hebben
-- =====================================================================
--
-- supplier_backfill.sql — hoeveel inkoopfacturen mét IBAN nog zonder leverancier staan
--   Dit is geen oordeel, want de app schrijft dezelfde kolom als de backfill. Een inkoopfactuur die
--   vandaag binnenkomt zonder herkende leverancier staat hier morgen ook in — die zegt niets over
--   deze migratie. Nul betekent 'gedraaid én bijgehouden'. Een klein getal met verse datums is
--   nieuwe post, geen mislukte migratie. Alleen een groot getal met datums van vóór de livegang
--   wijst terug naar dit bestand.
--
select count(*) as zonder_leverancier, min(created_at) as oudste
 from public.invoices
where direction = 'incoming'
  and status in ('processing', 'received')
  and vendor_iban is not null
  and length(regexp_replace(vendor_iban, '\s', '', 'g')) >= 15
  and supplier_id is null;

-- =====================================================================
-- NIETS MEER VAN TE ZIEN — en juist daarom NIET opnieuw draaien
-- =====================================================================
--
--   creditnota_one_per_original.sql
--     Deze migratie maakte de unieke index invoices_one_creditnota_per_original — één creditnota per
--     factuur. creditnota_partial.sql heeft die er later met opzet weer afgehaald, want een factuur
--     mag meer dan één DEELcreditnota dragen. Er is dus niets meer van te zien, en dat hoort zo.
--     NIET OPNIEUW DRAAIEN: de index terugzetten breekt de tweede deelcreditnota op elke factuur.
--     Wat er in de plaats van staat is public.assert_credit_within_original(), en die wordt
--     hierboven bij creditnota_partial.sql wél gemeten.
--
-- =====================================================================
-- OBJECTEN DIE LATER ZIJN OPGERUIMD — tellen niet mee in het oordeel
-- =====================================================================
--
-- Deze objecten worden door een LATERE migratie weer weggegooid. Hun afwezigheid bewijst
-- niets over de migratie die ze aanmaakte — die kan allang gedraaid hebben. Meetellen zou
-- een toegepaste migratie als OPEN aanmerken, en dat is de duurste soort fout die deze
-- lijst kan maken: hem nog een keer draaien.
--
--   accountant_invoice_mandate.sql → index accountant_invoice_mandates_one_active
--   accountant_subject_status.sql → index accountant_subject_status_unique
--   accountant_subject_status.sql → policy acc_status_owner_all
--   cash_settlement_invoice_link.sql → index cash_entries_one_settlement_per_invoice
--   creditnota_one_per_original.sql → index invoices_one_creditnota_per_original
--   snelstart_connection.sql → index snelstart_exports_user_invoice_pushed_uidx
--
-- =====================================================================
-- WEL AANGEMAAKT, MAAR BEWIJST NIETS — met de reden erbij
-- =====================================================================
--
-- Deze objecten worden door hun migratie aangemaakt, maar hun bestaan zegt niets over of
-- die migratie gedraaid heeft. Ze staan hier MET reden in plaats van stilletjes te
-- verdwijnen — wie de lijst leest hoort te zien waarom er niet naar gekeken wordt.
--
-- Ze staan in NIETS_BEWIJZEND in scripts/migration-inventory.ts. Een object dat gewoon
-- ontbreekt hoort daar NIET in: dat hoort OPEN te heten.
--
--   bank_transactions_column_grant.sql → bank_transactions_update_own
--       Deze policy BESTOND al — ze komt uit de oorspronkelijke dashboard-opzet en staat in geen enkele migratie, net als de basispolicies van invoices. De migratie maakt haar opnieuw aan omdat ze de hele vorm wil opschrijven die ze achterlaat, niet omdat ze nieuw is. Haar bestaan bewijst dus niets: op productie is het antwoord 'ja, die staat er' ook op de dag VOORDAT deze migratie ooit draaide. Wat wél alleen door deze migratie waar wordt, is de STAND eronder — het kolom-recht en de verdwenen delete-policy — en die staat in STAND_CONTROLE.
--   documents_content_hash_unique.sql → document_is_referenced
--       Steiger, geen fundament. Deze functie bestaat alleen om binnen DEZE migratie de eenmalige dedup-DELETE te rangschikken; geen enkele regel in src/ roept haar aan. Het blijvende resultaat is de unieke index uq_documents_user_content_hash, en die staat er. Haar afwezigheid betekent dus dat iemand de steiger heeft opgeruimd, niet dat de migratie niet liep.
--   documents_shared_and_storage_policies.sql → idx_documents_user_content_hash
--       Achterhaald door een LATERE beslissing, en niet door een DROP — daarom ziet de supersessie-regel hem niet. Deze niet-unieke index op (user_id, content_hash) is er gekomen met het argument dat een UNIQUE de 'nog een keer uploaden'-functie zou breken; documents_content_hash_unique.sql heeft die afweging later omgedraaid en zet uq_documents_user_content_hash op dezelfde kolommen. Die dekt dezelfde lookups. Hem alsnog aanmaken zou een tweede index op dezelfde twee kolommen zijn: schrijfkosten zonder leeswinst.

