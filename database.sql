-- =====================================================
-- BoekBrug — database.sql
-- Production schema snapshot (post Refactor Week)
-- Last regenerated: May 24, 2026
-- Source: production introspection (cedrndplmydqcmbszfmp)
-- =====================================================
-- This file reflects the CURRENT state of production DB after:
--   ✅ Phase 1   — Vault Encryption
--   ✅ Phase 2   — RLS Phase 2 (9 tables, 56 policies)
--   ✅ Phase 2.5 — Legacy Cleanup (8 vulnerabilities closed)
--   ✅ Vault Hotfix
--   ✅ BOEK-011  — Vault integration
--   ✅ BOEK-SECURITY-2 — Rate limit + Audit hardening
--   ✅ BOEK-031  — Audit refactor (logAuditAction)
--   ✅ Step 1h   — DROP plaintext columns from email_connections
--
-- IMPORTANT NOTES:
--   - email_connections uses Vault references (no plaintext tokens)
--   - audit_logs INSERT requires service_role (no policy for authenticated)
--   - notifications INSERT requires service_role (no policy for authenticated)
--   - rate_limits writes via service_role only (no INSERT/UPDATE policy)
--   - folders.is_system = true is protected from user modification
--
-- For context only — not meant to be executed directly.
-- Use Supabase CLI migrations for actual deployment.
-- =====================================================
--
-- =====================================================
-- ⚠️  SCHEMA-DRIFT NOTICE (SCH-1) — this snapshot is STALE
-- =====================================================
-- The May-24 snapshot below no longer matches production. AUTHORITATIVE sources
-- where they differ from this file:
--     • src/types/database.types.ts   (generated from prod)
--     • supabase/migrations/*.sql      (applied after this snapshot)
-- Confirmed drift NOT reflected in the table/policy sections below:
--
--   Tables present in prod but ABSENT here:
--     • invoice_counters            (supabase/migrations/factuur_b_numbering.sql)
--     • counterpart_memory          (supabase/migrations/bank_identity.sql)
--     • cash_entries                (supabase/migrations/cash_ledger.sql)
--     • accountant_subject_status   (B.4 'verwerkt' backing table — types only)
--     • email_skipped_attachments   (types only)
--
--   invoices — columns present in prod but ABSENT here (see database.types.ts):
--     payment_date, payment_method, payment_prepared_at, payment_reference,
--     vendor_iban, delivery_date, field_confidence (jsonb), source_message_id,
--     and the GENERATED column:
--         shared  =  (status IN ('sent','received','paid'))
--     plus UNIQUE (sender_id, invoice_number)  [factuur_b_numbering.sql].
--
--   bank_transactions — added by bank_identity.sql:
--     category, category_source, category_confirmed.
--   documents — added later: content_hash, shared (boolean), period, year.
--   profiles — added later: invoice_number_template, invoice_number_padding.
--
--   Functions/triggers:
--     • next_invoice_seq()  — the ATOMIC number allocator now in use
--       (factuur_b_numbering.sql). The generate_invoice_number() shown in
--       SECTION 5 below is DROPPED in prod (COUNT(*)+1, race-prone) — do NOT use.
--     • B.4 'verwerkt' guard trigger on invoices (fires on
--       accountant_status='verwerkt'; bypassed when auth.uid() IS NULL).
--       [AUDIT-2026-07] Now reproducible from the repo: SECTION 5 defines
--       prevent_verwerkt_invoice_changes() + invoices_verwerkt_guard, and
--       supabase/migrations/invoice_accountant_write_guard.sql applies the
--       same to an already-provisioned DB (prod's own copy, if named
--       differently, coexists harmlessly).
--
--   RLS:
--     • The invitations SELECT policy below is scoped to the inviter (zzper_id)
--       OR the invitee (accountant_email == auth.email()) — never "public USING
--       (true)". supabase/migrations/invitations_rls_scoped_read.sql applies the
--       same change to an already-provisioned DB; this snapshot and that migration
--       now agree, so a fresh provision is secure by default.
--
-- TODO: regenerate this file from a fresh production introspection.
-- =====================================================


-- =====================================================
-- SECTION 1 — TABLES (17 tables)
-- =====================================================

CREATE TABLE public.accountant_clients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  accountant_id uuid,
  zzper_id uuid,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT accountant_clients_pkey PRIMARY KEY (id),
  CONSTRAINT accountant_clients_accountant_id_fkey
    FOREIGN KEY (accountant_id) REFERENCES public.profiles(id),
  CONSTRAINT accountant_clients_zzper_id_fkey
    FOREIGN KEY (zzper_id) REFERENCES public.profiles(id),
  CONSTRAINT unique_accountant_client
    UNIQUE (accountant_id, zzper_id)
);

CREATE TABLE public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  ip_address text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE public.bank_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  date date,
  amount numeric,
  description text,
  counterpart_name text,
  reference text,
  status text DEFAULT 'pending'::text
    CHECK (status = ANY (ARRAY['matched'::text, 'not_found'::text, 'pending'::text])),
  invoice_id uuid,
  created_at timestamp without time zone DEFAULT now(),
  -- [CONTROL] reconciled to live prod — BANK-IDENTITY columns (see bank_identity.sql)
  category text,
  category_source text
    CHECK (category_source = ANY (ARRAY['ai'::text, 'memory'::text, 'user'::text, 'rule'::text])),
  category_confirmed boolean NOT NULL DEFAULT false,
  CONSTRAINT bank_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT bank_transactions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT bank_transactions_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL
);

-- [CONTROL] Present in LIVE prod but absent from this file AND from
-- supabase/migrations/ (prod-only drift). The accountant readiness "backend"
-- table — currently has ZERO application reads/writes (see control report H-3).
CREATE TABLE public.accountant_subject_status (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  accountant_id uuid NOT NULL,
  subject_type text NOT NULL
    CHECK (subject_type = ANY (ARRAY['invoice'::text, 'document'::text])),
  subject_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'te_verwerken'::text
    CHECK (status = ANY (ARRAY['te_verwerken'::text, 'in_behandeling'::text, 'verwerkt'::text, 'vraag'::text])),
  verwerkt_at timestamp with time zone,
  vraag_text text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT accountant_subject_status_pkey PRIMARY KEY (id),
  CONSTRAINT accountant_subject_status_accountant_id_fkey
    FOREIGN KEY (accountant_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.clients (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL,
  email text,
  kvk_number text,
  btw_number text,
  iban text,
  address text,
  postal_code text,
  city text,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT clients_pkey PRIMARY KEY (id),
  CONSTRAINT clients_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.deletion_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  export_confirmed boolean DEFAULT false,
  email_confirmed boolean DEFAULT false,
  deleted_at timestamp without time zone,
  data_eligible_for_deletion_at timestamp without time zone,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT deletion_requests_pkey PRIMARY KEY (id)
);

CREATE TABLE public.documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size bigint NOT NULL,
  file_type text NOT NULL,
  doc_type text,
  period text,
  year integer,
  invoice_id uuid,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  search_vector tsvector,
  ai_processed boolean DEFAULT false,
  ai_doc_type text,
  source text
    CHECK (source = ANY (ARRAY['email'::text, 'upload'::text, 'whatsapp'::text, 'camera'::text])),
  folder_id uuid,
  ai_suggested_folder text,
  starred boolean DEFAULT false,
  trashed boolean DEFAULT false,
  trashed_at timestamp with time zone,
  CONSTRAINT documents_pkey PRIMARY KEY (id),
  CONSTRAINT documents_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT documents_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL,
  CONSTRAINT documents_folder_id_fkey
    FOREIGN KEY (folder_id) REFERENCES public.folders(id) ON DELETE SET NULL
);

CREATE TABLE public.draft_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  accountant_id uuid,
  client_id uuid NOT NULL,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  CONSTRAINT draft_queue_pkey PRIMARY KEY (id),
  CONSTRAINT draft_queue_accountant_id_fkey
    FOREIGN KEY (accountant_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT draft_queue_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT draft_queue_unique_accountant_client
    UNIQUE (accountant_id, client_id)
);

-- ⚠️ POST-VAULT SCHEMA — plaintext tokens DROPPED in Step 1h
CREATE TABLE public.email_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  provider text NOT NULL
    CHECK (provider = ANY (ARRAY['gmail'::text, 'outlook'::text])),
  email text,
  connected_at timestamp without time zone DEFAULT now(),
  access_token_secret_id uuid,          -- Vault reference (encrypted)
  refresh_token_secret_id uuid,         -- Vault reference (encrypted)
  tokens_encrypted_at timestamp with time zone,
  CONSTRAINT email_connections_pkey PRIMARY KEY (id),
  CONSTRAINT email_connections_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT email_connections_unique_user_provider
    UNIQUE (user_id, provider)
);

CREATE TABLE public.folders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  name text NOT NULL,
  parent_id uuid,
  color text DEFAULT 'gray'::text,
  created_at timestamp without time zone DEFAULT now(),
  starred boolean DEFAULT false,
  is_system boolean DEFAULT false,
  folder_type text,
  CONSTRAINT folders_pkey PRIMARY KEY (id),
  CONSTRAINT folders_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT folders_parent_id_fkey
    FOREIGN KEY (parent_id) REFERENCES public.folders(id) ON DELETE CASCADE
);

CREATE TABLE public.invitations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  zzper_id uuid,
  accountant_email text NOT NULL,
  status text DEFAULT 'pending'::text
    CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text])),
  token uuid DEFAULT gen_random_uuid(),
  created_at timestamp without time zone DEFAULT now(),
  invited_by text DEFAULT 'zzper'::text,
  CONSTRAINT invitations_pkey PRIMARY KEY (id),
  CONSTRAINT invitations_zzper_id_fkey
    FOREIGN KEY (zzper_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT invitations_token_key UNIQUE (token)
);

CREATE TABLE public.invoice_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  invoice_id uuid,
  description text,
  quantity numeric,
  unit_price numeric,
  btw_rate numeric DEFAULT 21,
  line_total numeric,
  CONSTRAINT invoice_lines_pkey PRIMARY KEY (id),
  CONSTRAINT invoice_lines_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE
);

CREATE TABLE public.invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sender_id uuid,
  receiver_id uuid,
  invoice_number text,
  invoice_date date,
  due_date date,
  status text
    CHECK (status = ANY (ARRAY[
      'draft'::text, 'sent'::text, 'paid'::text, 'overdue'::text,
      'received'::text, 'processing'::text, 'processed'::text,
      'unclear'::text, 'archived'::text
    ])),
  direction text
    CHECK (direction = ANY (ARRAY['outgoing'::text, 'incoming'::text])),
  total_ex_btw numeric,
  btw_amount numeric,
  total_inc_btw numeric,
  pdf_url text,
  created_at timestamp without time zone DEFAULT now(),
  client_name text,
  client_email text,
  client_address text,
  client_postal_code text,
  client_city text,
  client_btw_number text,
  updated_at timestamp with time zone DEFAULT now(),
  search_vector tsvector,
  -- [VERWERKT-WOORDENLIJST] Only 'verwerkt' locks money; NULL and the other three are equally open
  -- to every guard (all written as "= 'verwerkt'", never "IS NOT NULL"). The constraint stood in
  -- production and in no migration, so a rebuild from this repo accepted any string in the column
  -- every payment guard reads — see invoice_accountant_status_vocabulary.sql.
  accountant_status text
    CHECK (accountant_status IS NULL OR accountant_status = ANY (ARRAY[
      'te_verwerken'::text, 'in_behandeling'::text, 'verwerkt'::text, 'vraag'::text])),
  marked_paid_at timestamp without time zone,
  source text
    CHECK (source = ANY (ARRAY['created'::text, 'email'::text, 'upload'::text, 'camera'::text])),
  invoice_type text DEFAULT 'factuur'::text
    CHECK (invoice_type = ANY (ARRAY[
      'factuur'::text, 'creditnota'::text, 'pro_forma'::text, 'offerte'::text
    ])),
  accountant_note text,
  replaced_by_number text,
  original_invoice_id uuid,
  offerte_converted_to uuid,
  source_message_id text,
  document_id uuid,
  -- [CONTROL] reconciled to live prod (introspection). `shared` is GENERATED and
  -- replaces the dropped `sent_to_accountant` flag as the accountant-visibility gate.
  payment_method text,
  shared boolean GENERATED ALWAYS AS (status = ANY (ARRAY['sent'::text, 'received'::text, 'paid'::text])) STORED,
  delivery_date date,
  field_confidence jsonb,
  payment_date date,
  vendor_iban text,
  payment_reference text,
  payment_prepared_at timestamp with time zone,
  -- [SUPPLIER-REGISTRY] canonical supplier link for incoming invoices (see supplier_registry.sql).
  supplier_id uuid,
  CONSTRAINT invoices_pkey PRIMARY KEY (id),
  CONSTRAINT invoices_sender_id_fkey
    FOREIGN KEY (sender_id) REFERENCES public.profiles(id),
  CONSTRAINT invoices_receiver_id_fkey
    FOREIGN KEY (receiver_id) REFERENCES public.profiles(id),
  CONSTRAINT invoices_original_invoice_id_fkey
    FOREIGN KEY (original_invoice_id) REFERENCES public.invoices(id),
  CONSTRAINT invoices_offerte_converted_to_fkey
    FOREIGN KEY (offerte_converted_to) REFERENCES public.invoices(id),
  CONSTRAINT invoices_document_id_fkey
    FOREIGN KEY (document_id) REFERENCES public.documents(id),
  CONSTRAINT invoices_supplier_id_fkey
    FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL
);

-- [SUPPLIER-REGISTRY] Canonical supplier (leverancier) registry for incoming invoices.
-- Keyed on IBAN (strong) then normalized name (fallback) so the same company stops appearing
-- under many spellings. Full definition + RLS in supabase/migrations/supplier_registry.sql.
CREATE TABLE public.suppliers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  name_key text,
  iban text,
  kvk_number text,
  btw_number text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_pkey PRIMARY KEY (id),
  CONSTRAINT suppliers_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL,
  receiver_id uuid NOT NULL,
  content text NOT NULL,
  read boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT messages_pkey PRIMARY KEY (id),
  CONSTRAINT messages_sender_id_fkey
    FOREIGN KEY (sender_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT messages_receiver_id_fkey
    FOREIGN KEY (receiver_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  title text NOT NULL,
  body text,
  type text
    CHECK (type = ANY (ARRAY[
      'invoice'::text, 'payment'::text, 'message'::text,
      'invite'::text, 'status'::text
    ])),
  read boolean DEFAULT false,
  created_at timestamp without time zone DEFAULT now(),
  link text,
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

CREATE TABLE public.profiles (
  id uuid NOT NULL,
  role text
    CHECK (role = ANY (ARRAY['zzper'::text, 'accountant'::text, 'client'::text])),
  full_name text,
  company_name text,
  kvk_number text,
  btw_number text,
  iban text,
  email text,
  phone text,
  created_at timestamp without time zone DEFAULT now(),
  address text,
  postal_code text,
  city text,
  onboarding_step integer NOT NULL DEFAULT 0,
  onboarding_done boolean NOT NULL DEFAULT false,
  preferred_language text DEFAULT 'nl'::text
    CHECK (preferred_language = ANY (ARRAY['nl'::text, 'en'::text, 'ar'::text, 'tr'::text])),
  referral_accountant_id uuid,
  -- [FAIR-USE] free = ondernemer binnen eerlijk gebruik · plus = € 12,99/mnd daarboven ·
  -- boekhouder = altijd gratis. Zie supabase/migrations/subscription_plans_fair_use.sql.
  subscription_plan text DEFAULT 'free'::text
    CHECK (subscription_plan = ANY (ARRAY[
      'free'::text, 'plus'::text, 'boekhouder'::text
    ])),
  subscription_stripe_id text,
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey
    FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT profiles_referral_accountant_id_fkey
    FOREIGN KEY (referral_accountant_id) REFERENCES public.profiles(id)
);

CREATE TABLE public.rate_limits (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  count integer NOT NULL DEFAULT 1,
  window_start timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT rate_limits_pkey PRIMARY KEY (id),
  CONSTRAINT rate_limits_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT rate_limits_unique_user_endpoint
    UNIQUE (user_id, endpoint),
  CONSTRAINT rate_limits_count_positive
    CHECK (count >= 0)
);

CREATE TABLE public.referrals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  accountant_id uuid,
  client_id uuid,
  active boolean DEFAULT true,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT referrals_pkey PRIMARY KEY (id),
  CONSTRAINT referrals_accountant_id_fkey
    FOREIGN KEY (accountant_id) REFERENCES public.profiles(id) ON DELETE CASCADE,
  CONSTRAINT referrals_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);


-- =====================================================
-- SECTION 2 — INDEXES (Non-PK)
-- =====================================================

-- documents
CREATE INDEX documents_folder_id_idx
  ON public.documents USING btree (folder_id);
CREATE INDEX documents_search_idx
  ON public.documents USING gin (search_vector);
CREATE INDEX documents_starred_idx
  ON public.documents USING btree (user_id, starred);
CREATE INDEX documents_trashed_idx
  ON public.documents USING btree (user_id, trashed);
CREATE INDEX documents_user_created
  ON public.documents USING btree (user_id, created_at DESC);
CREATE INDEX documents_user_year
  ON public.documents USING btree (user_id, year, period);

-- folders
CREATE INDEX folders_parent_id_idx
  ON public.folders USING btree (parent_id);
CREATE INDEX folders_user_id_idx
  ON public.folders USING btree (user_id);

-- folders — system folder protection (UNIQUE partial indexes)
CREATE UNIQUE INDEX folders_system_child_uniq
  ON public.folders USING btree (user_id, parent_id, name)
  WHERE (is_system = true);
CREATE UNIQUE INDEX folders_system_root_uniq
  ON public.folders USING btree (user_id, name)
  WHERE ((parent_id IS NULL) AND (is_system = true));

-- invoices — email dedup (CRITICAL — prevents duplicate Gmail imports)
CREATE UNIQUE INDEX idx_invoices_dedup_message
  ON public.invoices USING btree (receiver_id, source_message_id)
  WHERE ((direction = 'incoming'::text) AND (source_message_id IS NOT NULL));

CREATE INDEX idx_invoices_message_id
  ON public.invoices USING btree (source_message_id)
  WHERE (source_message_id IS NOT NULL);

CREATE INDEX invoices_search_idx
  ON public.invoices USING gin (search_vector);

-- [SEARCH] Trigram indexes so the global-search API's ILIKE '%term%' (leading
-- wildcard) predicates are index-backed instead of sequential scans. Mirrored in
-- supabase/migrations/search_engine.sql. Self-enables pg_trgm so a fresh provision
-- of this file never fails on gin_trgm_ops even if the Dashboard step was skipped.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS invoices_invoice_number_trgm
  ON public.invoices USING gin (invoice_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS invoices_client_name_trgm
  ON public.invoices USING gin (client_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS invoices_client_email_trgm
  ON public.invoices USING gin (client_email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS invoice_lines_description_trgm
  ON public.invoice_lines USING gin (description gin_trgm_ops);
CREATE INDEX IF NOT EXISTS invoice_lines_invoice_id_idx
  ON public.invoice_lines USING btree (invoice_id);
CREATE INDEX IF NOT EXISTS documents_file_name_trgm
  ON public.documents USING gin (file_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS documents_doc_type_trgm
  ON public.documents USING gin (doc_type gin_trgm_ops);
CREATE INDEX IF NOT EXISTS documents_ai_doc_type_trgm
  ON public.documents USING gin (ai_doc_type gin_trgm_ops);
CREATE INDEX IF NOT EXISTS documents_notes_trgm
  ON public.documents USING gin (notes gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_full_name_trgm
  ON public.profiles USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_company_name_trgm
  ON public.profiles USING gin (company_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_email_trgm
  ON public.profiles USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS clients_name_trgm
  ON public.clients USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS clients_email_trgm
  ON public.clients USING gin (email gin_trgm_ops);

-- rate_limits
CREATE INDEX idx_rate_limits_cleanup
  ON public.rate_limits USING btree (window_start);
CREATE INDEX idx_rate_limits_lookup
  ON public.rate_limits USING btree (user_id, endpoint);


-- =====================================================
-- SECTION 3 — ENABLE RLS ON ALL TABLES
-- =====================================================

ALTER TABLE public.accountant_clients    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deletion_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_queue           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_connections     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lines         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals             ENABLE ROW LEVEL SECURITY;


-- =====================================================
-- SECTION 4 — RLS POLICIES (56 policies)
-- =====================================================

-- ── accountant_clients (4) ──────────────────────────────
CREATE POLICY accountant_clients_select ON public.accountant_clients
  FOR SELECT TO authenticated
  USING ((accountant_id = auth.uid()) OR (zzper_id = auth.uid()));

-- ⚠️ [SEC-LINK] There is DELIBERATELY no authenticated INSERT policy on accountant_clients.
--    An earlier baseline shipped `WITH CHECK (accountant_id = auth.uid())` — an open self-link:
--    any authenticated user could insert {accountant_id: ME, zzper_id: VICTIM} via the anon key
--    that ships in the browser (the victim UUID leaks via invoice sender/receiver, messages, …),
--    linking themselves as any client's accountant and reading that client's shared invoices +
--    documents. That policy was dropped in supabase/migrations/accountant_clients_insert_consent.sql;
--    the baseline now omits it entirely so a FRESH deploy from this file is safe even before the
--    migration runs. Linking happens ONLY through the email-verified accept route, which inserts
--    via service_role (createPipelineClient, bypasses RLS) — see src/app/api/invite/accept/route.ts.
--    If authenticated linking is ever reintroduced it MUST be gated on an accepted invitation for
--    THIS (accountant, client) pair (see the migration for the exact WITH CHECK).

-- [SEC-LINK] There is deliberately NO UPDATE policy either. The one that used to sit here
--    constrained only accountant_id, leaving zzper_id free — so the holder of a single link row
--    could re-point it at any victim (`update({zzper_id: VICTIM}).eq('accountant_id', ME)`) and
--    reach the exact escalation the INSERT note above describes, through a different verb. It was
--    dropped in supabase/migrations/accountant_clients_update_consent.sql; the baseline now omits
--    it so a FRESH deploy from this file is safe even before that migration runs. No app code ever
--    UPDATEs this table — a link is created once by the verified accept route (service_role) and
--    from then on only read or deleted. If updating is ever needed it MUST pin zzper_id too.

CREATE POLICY accountant_clients_delete ON public.accountant_clients
  FOR DELETE TO authenticated
  USING ((accountant_id = auth.uid()) OR (zzper_id = auth.uid()));

-- ── audit_logs (1) — SELECT only, INSERT via service_role ──
CREATE POLICY "Users see own logs" ON public.audit_logs
  FOR SELECT TO public USING (auth.uid() = user_id);

-- ── bank_transactions (4) ───────────────────────────────
CREATE POLICY bank_transactions_select_own ON public.bank_transactions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY bank_transactions_insert_own ON public.bank_transactions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY bank_transactions_update_own ON public.bank_transactions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY bank_transactions_delete_own ON public.bank_transactions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ── clients (4) ─────────────────────────────────────────
CREATE POLICY clients_select_own ON public.clients
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY clients_insert_own ON public.clients
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY clients_update_own ON public.clients
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY clients_delete_own ON public.clients
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ── deletion_requests (1) ───────────────────────────────
CREATE POLICY deletion_requests_own ON public.deletion_requests
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── documents (4) ───────────────────────────────────────
CREATE POLICY documents_select_own ON public.documents
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY documents_insert_own ON public.documents
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY documents_update_own ON public.documents
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY documents_delete_own ON public.documents
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- [SEC-DOCS-RLS] Accountant read of a linked client's SHARED, non-trashed docs.
-- Captured/versioned in supabase/migrations/documents_accountant_read_policy.sql
-- (was prod-only). Mirrors invoices_accountant_read; additive to documents_select_own.
CREATE POLICY documents_accountant_read ON public.documents
  FOR SELECT TO authenticated
  USING (
    shared = true
    AND trashed IS NOT TRUE
    AND is_my_accountant_client(user_id)
  );

-- ── draft_queue (4) ─────────────────────────────────────
CREATE POLICY draft_queue_select_own ON public.draft_queue
  FOR SELECT TO authenticated USING (accountant_id = auth.uid());

CREATE POLICY draft_queue_insert_own ON public.draft_queue
  FOR INSERT TO authenticated WITH CHECK (accountant_id = auth.uid());

CREATE POLICY draft_queue_update_own ON public.draft_queue
  FOR UPDATE TO authenticated
  USING (accountant_id = auth.uid()) WITH CHECK (accountant_id = auth.uid());

CREATE POLICY draft_queue_delete_own ON public.draft_queue
  FOR DELETE TO authenticated USING (accountant_id = auth.uid());

-- ── email_connections (4) ───────────────────────────────
CREATE POLICY email_connections_select_own ON public.email_connections
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY email_connections_insert_own ON public.email_connections
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY email_connections_update_own ON public.email_connections
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY email_connections_delete_own ON public.email_connections
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ── folders (4) — with is_system protection ─────────────
CREATE POLICY folders_select_own ON public.folders
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY folders_insert_own ON public.folders
  FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()) AND (is_system = false));

CREATE POLICY folders_update_own ON public.folders
  FOR UPDATE TO authenticated
  USING ((user_id = auth.uid()) AND (is_system = false))
  WITH CHECK ((user_id = auth.uid()) AND (is_system = false));

CREATE POLICY folders_delete_own ON public.folders
  FOR DELETE TO authenticated
  USING ((user_id = auth.uid()) AND (is_system = false));

-- ── invitations (2) ─────────────────────────────────────
-- [SEC-INVITE] Read is scoped to the two parties of the invitation: the inviter
-- (zzper_id) or the invitee (accountant_email == auth.email()). The old
-- "public USING (true)" let ANY caller — including anonymous — enumerate every
-- accept-token and invited e-mail (invitation-hijack + info disclosure). Server
-- paths that must read across users (/api/invite/info) use service_role and
-- bypass RLS. Mirrors supabase/migrations/invitations_rls_scoped_read.sql.
CREATE POLICY "invitee or inviter can read invitations" ON public.invitations
  FOR SELECT TO authenticated
  USING (
    auth.uid() = zzper_id
    OR lower(accountant_email) = lower(auth.email())
  );

CREATE POLICY "zzper can insert invitations" ON public.invitations
  FOR INSERT TO public WITH CHECK (auth.uid() = zzper_id);

-- ── invoice_lines (6) ───────────────────────────────────
CREATE POLICY invoice_lines_select_own ON public.invoice_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = invoice_lines.invoice_id AND i.sender_id = auth.uid()
  ));

CREATE POLICY invoice_lines_select_receiver ON public.invoice_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = invoice_lines.invoice_id AND i.receiver_id = auth.uid()
  ));

CREATE POLICY invoice_lines_select_accountant ON public.invoice_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM invoices i
    JOIN accountant_clients ac ON ac.zzper_id = i.sender_id
    WHERE i.id = invoice_lines.invoice_id
      AND ac.accountant_id = auth.uid()
      AND i.status = 'paid'
  ));

CREATE POLICY invoice_lines_insert_own ON public.invoice_lines
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = invoice_lines.invoice_id AND i.sender_id = auth.uid()
  ));

CREATE POLICY invoice_lines_update_own ON public.invoice_lines
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = invoice_lines.invoice_id AND i.sender_id = auth.uid()
  ));

CREATE POLICY invoice_lines_delete_own ON public.invoice_lines
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = invoice_lines.invoice_id AND i.sender_id = auth.uid()
  ));

-- ── invoices (7) ──── [CONTROL] accountant policies reconciled to live ──
CREATE POLICY invoices_zzp_select ON public.invoices
  FOR SELECT TO authenticated
  USING ((sender_id = auth.uid()) OR (receiver_id = auth.uid()));

CREATE POLICY invoices_zzp_insert ON public.invoices
  FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid());

CREATE POLICY invoices_zzp_update ON public.invoices
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid()) WITH CHECK (sender_id = auth.uid());

CREATE POLICY invoices_zzp_delete ON public.invoices
  FOR DELETE TO authenticated
  USING ((sender_id = auth.uid()) AND (status = 'draft'::text));

-- [CONTROL] Reconciled against LIVE prod via introspection (pg_policies +
-- pg_get_functiondef). The pre-BRIDGE-A names invoices_accountant_select/_update
-- and their sent_to_accountant + voldaan bodies NO LONGER EXIST on prod. The live
-- policies use the GENERATED `shared` column and the helper
-- is_my_accountant_client(uuid) (defined in the trigger section below), and check
-- BOTH sender and receiver so the accountant sees a linked client's outgoing AND
-- incoming invoices.
CREATE POLICY invoices_accountant_read ON public.invoices
  FOR SELECT TO authenticated
  USING (
    shared = true
    AND (is_my_accountant_client(sender_id) OR is_my_accountant_client(receiver_id))
  );

CREATE POLICY invoices_accountant_update_v2 ON public.invoices
  FOR UPDATE TO authenticated
  USING (
    shared = true
    AND (is_my_accountant_client(sender_id) OR is_my_accountant_client(receiver_id))
  )
  WITH CHECK (
    is_my_accountant_client(sender_id) OR is_my_accountant_client(receiver_id)
  );

CREATE POLICY invoices_receiver_update ON public.invoices
  FOR UPDATE TO authenticated
  USING ((receiver_id = auth.uid()) AND (direction = 'incoming'::text))
  WITH CHECK ((receiver_id = auth.uid()) AND (direction = 'incoming'::text));

-- ── messages (3) ────────────────────────────────────────
CREATE POLICY messages_select_participant ON public.messages
  FOR SELECT TO authenticated
  USING ((sender_id = auth.uid()) OR (receiver_id = auth.uid()));

CREATE POLICY messages_insert_as_sender ON public.messages
  FOR INSERT TO authenticated WITH CHECK (sender_id = auth.uid());

CREATE POLICY messages_update_read_status ON public.messages
  FOR UPDATE TO authenticated
  USING (receiver_id = auth.uid()) WITH CHECK (receiver_id = auth.uid());

-- ── notifications (3) — INSERT via service_role only ────
CREATE POLICY notifications_select_own ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY notifications_update_own ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY notifications_delete_own ON public.notifications
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ── profiles (4) ────────────────────────────────────────
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid());

CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY profiles_select_accountant_clients ON public.profiles
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM accountant_clients ac
    WHERE ac.accountant_id = auth.uid() AND ac.zzper_id = profiles.id
  ));

-- ── rate_limits (1) — INSERT via service_role only ──────
CREATE POLICY rate_limits_select_own ON public.rate_limits
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- ── referrals (1) ───────────────────────────────────────
CREATE POLICY referrals_accountant ON public.referrals
  FOR ALL TO authenticated USING (accountant_id = auth.uid());


-- =====================================================
-- SECTION 5 — FUNCTIONS (11 functions)
-- =====================================================

-- ── Rate Limiting ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_user_id uuid,
  p_endpoint text,
  p_max_requests integer,
  p_window_minutes integer
)
RETURNS TABLE(allowed boolean, remaining integer, reset_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now           timestamptz := now();
  v_window_ms     interval    := (p_window_minutes || ' minutes')::interval;
  v_current_count integer;
  v_window_start  timestamptz;
BEGIN
  INSERT INTO public.rate_limits (user_id, endpoint, count, window_start)
  VALUES (p_user_id, p_endpoint, 1, v_now)
  ON CONFLICT (user_id, endpoint) DO UPDATE
  SET
    count = CASE
      WHEN public.rate_limits.window_start + v_window_ms <= v_now
        THEN 1
      ELSE public.rate_limits.count + 1
    END,
    window_start = CASE
      WHEN public.rate_limits.window_start + v_window_ms <= v_now
        THEN v_now
      ELSE public.rate_limits.window_start
    END
  RETURNING
    public.rate_limits.count,
    public.rate_limits.window_start
  INTO v_current_count, v_window_start;

  RETURN QUERY SELECT
    (v_current_count <= p_max_requests)                    AS allowed,
    GREATEST(0, p_max_requests - v_current_count)::integer AS remaining,
    (v_window_start + v_window_ms)                         AS reset_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_old_rate_limits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.rate_limits
  WHERE window_start < (now() - interval '24 hours');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ── Search Vectors ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.documents_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  new.search_vector := to_tsvector('simple',
    coalesce(new.file_name, '') || ' ' ||
    coalesce(new.doc_type, '') || ' ' ||
    coalesce(new.notes, '')
  );
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.invoices_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  new.search_vector := to_tsvector('simple',
    coalesce(new.invoice_number, '') || ' ' ||
    coalesce(new.client_name, '') || ' ' ||
    coalesce(new.client_email, '')
  );
  RETURN new;
END;
$$;

-- [SEARCH] Fuzzy (typo-tolerant) search via pg_trgm. SECURITY INVOKER → the caller's
-- RLS applies, so only rows the user may already see are returned. Used by /api/search
-- to augment sparse exact/substring results. Mirrored in supabase/migrations/search_smart.sql.
-- Three signals for typo recall: similarity() (whole-string trigram, 0.2),
-- word_similarity() (best-word trigram, 0.4), and a subsequence-LIKE ('fmz' → '%f%m%z%',
-- ≥3 chars) that catches DROPPED letters/abbreviations where trigrams fail — "fmz" matches
-- "FAMZFOOD" but not "Doyum Food"/"Vars Foods". Uses FUNCTIONS (not % / <% operators) with
-- explicit thresholds because Supabase forbids setting pg_trgm.*_threshold in a function SET.
-- q is stripped to [a-z0-9] for the LIKE branch → no wildcard/regex injection. Seq scan, but
-- only when results are sparse, over RLS-bounded rows, with LIMIT. See search_smart.sql.
CREATE OR REPLACE FUNCTION public.search_invoices_fuzzy(q text)
RETURNS SETOF public.invoices
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT i.*
  FROM public.invoices i,
       LATERAL (SELECT regexp_replace(lower(q), '[^a-z0-9]', '', 'g') AS qs) n,
       LATERAL (SELECT '%' || regexp_replace(n.qs, '(.)', '\1%', 'g') AS pat, length(n.qs) AS qlen) p
  WHERE length(btrim(q)) >= 2
    AND (
      similarity(coalesce(i.client_name, ''), q) >= 0.2
      OR word_similarity(q, coalesce(i.client_name, '')) >= 0.4
      OR (p.qlen >= 3 AND lower(coalesce(i.client_name, '')) LIKE p.pat)
      OR similarity(coalesce(i.invoice_number, ''), q) >= 0.2
      OR word_similarity(q, coalesce(i.invoice_number, '')) >= 0.4
      OR (p.qlen >= 3 AND lower(coalesce(i.invoice_number, '')) LIKE p.pat)
    )
  ORDER BY GREATEST(
      similarity(coalesce(i.client_name, ''), q),
      word_similarity(q, coalesce(i.client_name, '')),
      similarity(coalesce(i.invoice_number, ''), q),
      word_similarity(q, coalesce(i.invoice_number, ''))
    ) DESC
  LIMIT 8;
$$;

CREATE OR REPLACE FUNCTION public.search_clients_fuzzy(q text)
RETURNS SETOF public.clients
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT c.*
  FROM public.clients c,
       LATERAL (SELECT regexp_replace(lower(q), '[^a-z0-9]', '', 'g') AS qs) n,
       LATERAL (SELECT '%' || regexp_replace(n.qs, '(.)', '\1%', 'g') AS pat, length(n.qs) AS qlen) p
  WHERE length(btrim(q)) >= 2
    AND (
      similarity(coalesce(c.name, ''), q) >= 0.2
      OR word_similarity(q, coalesce(c.name, '')) >= 0.4
      OR (p.qlen >= 3 AND lower(coalesce(c.name, '')) LIKE p.pat)
      OR similarity(coalesce(c.email, ''), q) >= 0.2
      OR word_similarity(q, coalesce(c.email, '')) >= 0.4
      OR (p.qlen >= 3 AND lower(coalesce(c.email, '')) LIKE p.pat)
    )
  ORDER BY GREATEST(
      similarity(coalesce(c.name, ''), q),
      word_similarity(q, coalesce(c.name, '')),
      similarity(coalesce(c.email, ''), q),
      word_similarity(q, coalesce(c.email, ''))
    ) DESC
  LIMIT 5;
$$;

-- Fuzzy document-match (own, non-trashed) on file_name/type; same 3-signal approach.
CREATE OR REPLACE FUNCTION public.search_documents_fuzzy(q text)
RETURNS SETOF public.documents
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT d.*
  FROM public.documents d,
       LATERAL (SELECT regexp_replace(lower(q), '[^a-z0-9]', '', 'g') AS qs) n,
       LATERAL (SELECT '%' || regexp_replace(n.qs, '(.)', '\1%', 'g') AS pat, length(n.qs) AS qlen) p
  WHERE length(btrim(q)) >= 2
    AND d.trashed = false
    AND (
      similarity(coalesce(d.file_name, ''), q) >= 0.2
      OR word_similarity(q, coalesce(d.file_name, '')) >= 0.4
      OR (p.qlen >= 3 AND lower(coalesce(d.file_name, '')) LIKE p.pat)
      OR word_similarity(q, coalesce(d.ai_doc_type, '')) >= 0.4
      OR word_similarity(q, coalesce(d.doc_type, '')) >= 0.4
    )
  ORDER BY GREATEST(
      similarity(coalesce(d.file_name, ''), q),
      word_similarity(q, coalesce(d.file_name, '')),
      word_similarity(q, coalesce(d.ai_doc_type, '')),
      word_similarity(q, coalesce(d.doc_type, ''))
    ) DESC
  LIMIT 6;
$$;

-- Fuzzy folder-match on folder name.
CREATE OR REPLACE FUNCTION public.search_folders_fuzzy(q text)
RETURNS SETOF public.folders
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT f.*
  FROM public.folders f,
       LATERAL (SELECT regexp_replace(lower(q), '[^a-z0-9]', '', 'g') AS qs) n,
       LATERAL (SELECT '%' || regexp_replace(n.qs, '(.)', '\1%', 'g') AS pat, length(n.qs) AS qlen) p
  WHERE length(btrim(q)) >= 2
    AND (
      similarity(coalesce(f.name, ''), q) >= 0.2
      OR word_similarity(q, coalesce(f.name, '')) >= 0.4
      OR (p.qlen >= 3 AND lower(coalesce(f.name, '')) LIKE p.pat)
    )
  ORDER BY GREATEST(
      similarity(coalesce(f.name, ''), q),
      word_similarity(q, coalesce(f.name, ''))
    ) DESC
  LIMIT 10;
$$;

GRANT EXECUTE ON FUNCTION public.search_invoices_fuzzy(text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_clients_fuzzy(text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_documents_fuzzy(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_folders_fuzzy(text)   TO authenticated;

-- ── Invoice Numbering ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.generate_invoice_number(user_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  year text;
  count int;
  invoice_num text;
BEGIN
  year := to_char(now(), 'YYYY');
  SELECT count(*) INTO count
  FROM invoices
  WHERE sender_id = user_id
    AND to_char(created_at, 'YYYY') = year;
  invoice_num := year || '-' || lpad((count + 1)::text, 3, '0');
  RETURN invoice_num;
END;
$$;

-- ── Accountant Lookup ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_accountant_for_zzper(zzper_uuid uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  accountant_uuid uuid;
BEGIN
  SELECT accountant_id INTO accountant_uuid
  FROM accountant_clients
  WHERE zzper_id = zzper_uuid
  LIMIT 1;
  RETURN accountant_uuid;
END;
$$;

-- ── New User Trigger ────────────────────────────────────

-- [COHERENCE-REGISTER] Populate the profile from signup metadata (role/company/kvk/
-- btw/onboarding_step) so email/password registration works with email confirmation
-- ENABLED — the browser can no longer write the profile (anon RLS), so this SECURITY
-- DEFINER trigger is the single writer. See migrations/register_profile_from_metadata.sql.
--
-- ⚠️ NIET DE NIEUWSTE VERSIE. migrations/account_purpose_archief.sql vervangt deze functie
-- door een variant die ook `account_purpose` uit de metadata leest en `onboarding_done`
-- meteen op true zet voor een archiefaccount. In productie IS die migratie toegepast — gemeten
-- op 31 juli 2026 met de query onderaan docs/WELKE_MIGRATIES_STAAN_ER.sql, die zowel de kolom
-- als de trigger-helft bevestigde. Dit bestand loopt op dat punt dus achter.
--
-- Bouw je hiermee een VERSE database (dev, staging, herstel na incident), draai dan ook die
-- migratie. Doe je dat niet, dan werkt alles behalve het archiefpad van /bewaarplicht: wie
-- via ?doel=archief registreert komt binnen als gewoon boekhoudaccount en loopt de
-- onboarding-wizard in. De app valt daar zelf op terug (zie src/lib/account-purpose.ts) —
-- het breekt niets, het is alleen stil.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  meta jsonb := COALESCE(new.raw_user_meta_data, '{}'::jsonb);
  v_role text;
  v_step int;
BEGIN
  v_role := CASE
    WHEN meta->>'role' IN ('zzper', 'accountant') THEN meta->>'role'
    ELSE 'zzper'
  END;

  BEGIN
    v_step := COALESCE(NULLIF(meta->>'onboarding_step', ''), '1')::int;
  EXCEPTION WHEN others THEN
    v_step := 1;
  END;
  IF v_step IS NULL OR v_step < 1 THEN
    v_step := 1;
  END IF;

  INSERT INTO public.profiles (
    id, email, full_name,
    company_name, kvk_number, btw_number,
    onboarding_step, onboarding_done, role
  ) VALUES (
    new.id,
    new.email,
    NULLIF(meta->>'full_name', ''),
    NULLIF(meta->>'company_name', ''),
    NULLIF(meta->>'kvk_number', ''),
    NULLIF(meta->>'btw_number', ''),
    v_step,
    false,
    v_role
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

-- ── Accountant-linkage helper ────────────────────────────
-- [CONTROL] reconciled to live prod. SECURITY DEFINER so RLS policies can call it
-- without recursing into accountant_clients' own policies. Used by the live
-- invoices_accountant_read / _update_v2 policies.
CREATE OR REPLACE FUNCTION public.is_my_accountant_client(client uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.accountant_clients ac
    WHERE ac.accountant_id = auth.uid()
      AND ac.zzper_id      = client
  );
$$;

-- ── Invoice Amount Protection (Trigger function) ────────
-- Allows: service_role + invoice owner + incoming-invoice receiver.
-- Blocks: accountant modifying amounts/dates.
-- [CONTROL] reconciled to live prod: NOT security definer; the sent_to_accountant
-- check was dropped (column gone — `shared` is GENERATED so a direct write is
-- rejected by Postgres); added the incoming-receiver exception.
CREATE OR REPLACE FUNCTION public.prevent_accountant_amount_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Exception 1: service_role / pipeline (auth.uid() = NULL)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  -- Exception 2: ZZP invoice owner (sender) may change anything
  IF OLD.sender_id = auth.uid() THEN
    RETURN NEW;
  END IF;
  -- Exception 3: receiver of an incoming invoice (mark-as-paid)
  IF OLD.receiver_id = auth.uid() AND OLD.direction = 'incoming' THEN
    RETURN NEW;
  END IF;
  -- Everyone else (accountant) — protected columns.
  -- [AUDIT-2026-07] Extended (invoice_accountant_write_guard.sql): the
  -- accountant UPDATE policy is not column-restricted, so direction/status/
  -- receiver_id/payment fields were still writable outside every guarded app
  -- path. The accountant's only legitimate invoice write is accountant_status.
  IF (NEW.total_ex_btw        IS DISTINCT FROM OLD.total_ex_btw)        OR
     (NEW.btw_amount          IS DISTINCT FROM OLD.btw_amount)          OR
     (NEW.total_inc_btw       IS DISTINCT FROM OLD.total_inc_btw)       OR
     (NEW.invoice_date        IS DISTINCT FROM OLD.invoice_date)        OR
     (NEW.due_date            IS DISTINCT FROM OLD.due_date)            OR
     (NEW.sender_id           IS DISTINCT FROM OLD.sender_id)           OR
     (NEW.receiver_id         IS DISTINCT FROM OLD.receiver_id)         OR
     (NEW.direction           IS DISTINCT FROM OLD.direction)           OR
     (NEW.status              IS DISTINCT FROM OLD.status)              OR
     (NEW.amount_paid         IS DISTINCT FROM OLD.amount_paid)         OR
     (NEW.payment_method      IS DISTINCT FROM OLD.payment_method)      OR
     (NEW.payment_date        IS DISTINCT FROM OLD.payment_date)        OR
     (NEW.marked_paid_at      IS DISTINCT FROM OLD.marked_paid_at)      OR
     (NEW.payment_prepared_at IS DISTINCT FROM OLD.payment_prepared_at) OR
     (NEW.pay_token           IS DISTINCT FROM OLD.pay_token)           OR
     (NEW.invoice_number      IS DISTINCT FROM OLD.invoice_number)      OR
     (NEW.invoice_type        IS DISTINCT FROM OLD.invoice_type)
  THEN
    RAISE EXCEPTION
      'Permission denied: only the invoice owner can modify amounts, dates, status or payment fields (invoice_id: %)',
      OLD.id;
  END IF;
  RETURN NEW;
END;
$$;

-- ── [AUDIT-2026-07] B.4 'verwerkt' guard — now reproducible from the repo ────
-- (invoice_accountant_write_guard.sql). Once the accountant marks an invoice
-- 'verwerkt', its financial fields are frozen for every SESSION write (owner
-- included); changing accountant_status itself stays allowed (the undo flow).
-- The error message deliberately contains 'verwerkt' — pay-toggle and the
-- confirm route detect the conflict by that substring.
CREATE OR REPLACE FUNCTION public.prevent_verwerkt_invoice_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.accountant_status IS DISTINCT FROM 'verwerkt' THEN
    RETURN NEW;
  END IF;
  IF (NEW.total_ex_btw   IS DISTINCT FROM OLD.total_ex_btw)   OR
     (NEW.btw_amount     IS DISTINCT FROM OLD.btw_amount)     OR
     (NEW.total_inc_btw  IS DISTINCT FROM OLD.total_inc_btw)  OR
     (NEW.invoice_date   IS DISTINCT FROM OLD.invoice_date)   OR
     (NEW.due_date       IS DISTINCT FROM OLD.due_date)       OR
     (NEW.invoice_number IS DISTINCT FROM OLD.invoice_number) OR
     (NEW.status         IS DISTINCT FROM OLD.status)         OR
     (NEW.amount_paid    IS DISTINCT FROM OLD.amount_paid)    OR
     (NEW.payment_method IS DISTINCT FROM OLD.payment_method) OR
     (NEW.payment_date   IS DISTINCT FROM OLD.payment_date)   OR
     (NEW.marked_paid_at IS DISTINCT FROM OLD.marked_paid_at)
  THEN
    RAISE EXCEPTION
      'Factuur % is verwerkt door de boekhouder — vraag eerst om de verwerking ongedaan te maken',
      COALESCE(OLD.invoice_number, OLD.id::text);
  END IF;
  RETURN NEW;
END;
$$;

-- ── Vault Helpers (post-Hotfix) ─────────────────────────

CREATE OR REPLACE FUNCTION public.vault_read_secret(p_secret_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'vault', 'public'
AS $$
DECLARE
  v_decrypted text;
BEGIN
  IF p_secret_id IS NULL THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO v_decrypted
  FROM vault.decrypted_secrets
  WHERE id = p_secret_id;
  RETURN v_decrypted;
END;
$$;

CREATE OR REPLACE FUNCTION public.vault_update_or_create_secret(
  p_secret_id uuid,
  p_value text,
  p_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'vault', 'public'
AS $$
DECLARE
  result_id uuid;
BEGIN
  IF p_secret_id IS NOT NULL THEN
    PERFORM vault.update_secret(p_secret_id, p_value, p_name, NULL);
    RETURN p_secret_id;
  END IF;
  SELECT vault.create_secret(p_value, p_name, '') INTO result_id;
  RETURN result_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.vault_delete_secret(p_secret_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'vault', 'public'
AS $$
BEGIN
  IF p_secret_id IS NULL THEN RETURN false; END IF;
  DELETE FROM vault.secrets WHERE id = p_secret_id;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;


-- =====================================================
-- SECTION 6 — FUNCTION PERMISSIONS
-- =====================================================

-- Vault functions: service_role only
REVOKE EXECUTE ON FUNCTION public.vault_read_secret(uuid) FROM PUBLIC, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.vault_read_secret(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.vault_update_or_create_secret(uuid, text, text) FROM PUBLIC, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.vault_update_or_create_secret(uuid, text, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.vault_delete_secret(uuid) FROM PUBLIC, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.vault_delete_secret(uuid) TO service_role;

-- Rate limit functions: service_role only
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(uuid, text, integer, integer) FROM PUBLIC, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.check_rate_limit(uuid, text, integer, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.cleanup_old_rate_limits() FROM PUBLIC, authenticated, anon;
GRANT  EXECUTE ON FUNCTION public.cleanup_old_rate_limits() TO service_role;


-- =====================================================
-- SECTION 7 — TRIGGERS (5 active)
-- =====================================================

-- New user → auto-create profile (in auth.users)
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Invoice search vector updates
CREATE TRIGGER invoices_search_vector_trigger
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.invoices_search_vector_update();

-- Document search vector updates
CREATE TRIGGER documents_search_vector_trigger
  BEFORE INSERT OR UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_search_vector_update();

-- Protect invoice amounts from accountant modification
CREATE TRIGGER prevent_accountant_amount_changes
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.prevent_accountant_amount_changes();

-- [AUDIT-2026-07] B.4 verwerkt guard (see prevent_verwerkt_invoice_changes above)
CREATE TRIGGER invoices_verwerkt_guard
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.prevent_verwerkt_invoice_changes();


-- =====================================================
-- SECTION 8 — STORAGE
-- =====================================================
--
-- Bucket "documents" (private) — manually created in Supabase Dashboard
-- File size limit: 50 MB
--
-- Storage policies (run in Storage SQL editor, NOT in this file):
--
-- CREATE POLICY "documents_upload"
-- ON storage.objects FOR INSERT TO authenticated
-- WITH CHECK (
--   bucket_id = 'documents' AND
--   (storage.foldername(name))[1] = auth.uid()::text
-- );
--
-- CREATE POLICY "documents_read"
-- ON storage.objects FOR SELECT TO authenticated
-- USING (
--   bucket_id = 'documents' AND
--   (storage.foldername(name))[1] = auth.uid()::text
-- );
--
-- CREATE POLICY "documents_delete"
-- ON storage.objects FOR DELETE TO authenticated
-- USING (
--   bucket_id = 'documents' AND
--   (storage.foldername(name))[1] = auth.uid()::text
-- );


-- =====================================================
-- SECTION 9 — REQUIRED EXTENSIONS
-- =====================================================
--
-- Before applying this schema, enable in Supabase Dashboard:
--   Extensions → Enable:
--     - pgsodium      (for vault encryption)
--     - supabase_vault (for encrypted secrets)
--     - pg_cron       (for cleanup_old_rate_limits scheduling)
--     - pg_trgm       (for ILIKE '%..%' search trigram indexes — see SECTION 3 / search_engine.sql)
--
-- pg_cron job for rate_limits cleanup (in production: daily):
--   SELECT cron.schedule(
--     'cleanup-rate-limits',
--     '0 3 * * *',  -- 3am daily
--     'SELECT public.cleanup_old_rate_limits()'
--   );


-- =====================================================
-- END OF SCHEMA
-- =====================================================
-- Total: 17 tables + 56 RLS policies + 11 functions + 4 triggers
-- Security: Vault-encrypted OAuth tokens, atomic rate limiting,
--           service_role-only audit writes, RLS on every table.
-- =====================================================
