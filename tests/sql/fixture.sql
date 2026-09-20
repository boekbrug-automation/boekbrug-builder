-- [SEAM] The smallest database allocate_bank_payment can be true against.
--
-- Deliberately NOT a copy of the production schema. It declares exactly the columns the function
-- reads and writes, and nothing else — because a fixture that invents columns proves the function
-- against a database we do not have, which is the failure this whole directory exists to stop.
-- If the function starts touching a new column, this file fails first and loudly.
--
-- auth.uid() is a stub returning NULL, which is the service-role case: the caller guard then pins
-- the call by p_user_id alone. The test overrides it to impersonate a stranger where that matters.

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;

CREATE TABLE public.bank_transactions (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL,
  amount     numeric,      -- SIGNED: negative is money out
  date       date,
  status     text,
  invoice_id uuid,
  -- [KOLOMRECHT] The only three columns a logged-in session may write on this table. They are here
  -- because the privilege boundary is measured against the REAL shape: a column grant cannot be
  -- tested on a table that lacks the columns it names.
  category           text,
  category_source    text,
  category_confirmed boolean
);

CREATE TABLE public.invoices (
  id                uuid PRIMARY KEY,
  sender_id         uuid,
  receiver_id       uuid,
  status            text,
  accountant_status text,
  -- [CREDITNOTA] Which way this invoice moves money — 'incoming' is a bill you pay, 'outgoing' a
  -- sale you are paid for. Together with the creditnota test and the LINE's own sign it decides
  -- whether a link spends a bank line or gives money back to it. Not optional colour: without it
  -- the sign is guessed from the invoice type alone, which is right for a batch and wrong for a
  -- refund.
  direction         text NOT NULL DEFAULT 'incoming',
  invoice_type      text,
  total_inc_btw     numeric,   -- SIGNED: a creditnota is negative
  amount_paid       numeric DEFAULT 0,
  payment_method    text,
  marked_paid_at    timestamptz,
  payment_date      date
);

-- The link table, shaped as bank_tx_invoices.sql + invoice_manual_payments.sql leave it.
--
-- Two details here are load-bearing and were wrong in the first version of this fixture, which is
-- the fixture's own lesson: a surrogate `id` primary key with a UNIQUE INDEX on the pair, NOT a
-- composite primary key. A PRIMARY KEY column cannot be NULL, and apply_manual_payment writes
-- transaction_id NULL on purpose — a manual instalment belongs to no bank line. Declared as a
-- composite PK, every manual payment is rejected by the fixture and the test blames the function.
--
-- UNIQUE treats NULLs as distinct, so several manual instalments on one invoice coexist while
-- allocate_bank_payment's ON CONFLICT (transaction_id, invoice_id) still finds its row.
CREATE TABLE public.bank_tx_invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  transaction_id uuid,          -- NULL = a manual payment, not a bank line
  invoice_id     uuid NOT NULL,
  amount_applied numeric,       -- MAGNITUDE, per invoice — the sign is derived, never stored
  paid_on        date,
  method         text,
  client_key     uuid,
  created_at     timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX bank_tx_invoices_unique_pair
  ON public.bank_tx_invoices (transaction_id, invoice_id);

-- [FACTUUR-B] The live invoice-number counter. Written ONLY by next_invoice_seq and
-- seed_invoice_counter — there are no INSERT/UPDATE/DELETE policies for the session client.
CREATE TABLE public.invoice_counters (
  user_id  uuid NOT NULL,
  year     int  NOT NULL,   -- a calendar year, or 0 for continuous numbering
  type     text NOT NULL,
  last_seq int  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, year, type)
);

-- The roles the migrations GRANT to. Created only if absent so a real Supabase-like database can
-- run this file too. `anon` joins them because a privilege seam has to be able to ASK about the
-- role that reaches the database with no session at all — the one whose EXECUTE rights matter most
-- and are easiest to leave standing by accident.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')          THEN CREATE ROLE anon;          END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role')  THEN CREATE ROLE service_role;  END IF;
END $$;

-- ── [SEAM-STANDAARDRECHT] Supabase deelt EXECUTE uit voordat een migratie iets doet ────────────
--
-- Zonder deze regel bewijst een privilege-seam het goede ding in een wereld waarin de fout niet
-- KAN bestaan. Een kale PostgreSQL geeft EXECUTE op een nieuwe functie alleen aan PUBLIC, dus
-- `REVOKE ... FROM PUBLIC` haalt daar ook anon en authenticated onderuit — die erven het recht via
-- PUBLIC en hebben zelf niets. De test werd groen en de productie stond open.
--
-- Supabase draait op elk project `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON
-- FUNCTIONS TO anon, authenticated, service_role`. Dat is een DIRECTE toekenning aan die rollen,
-- en een REVOKE van PUBLIC raakt hem niet. Precies dat verschil liet fair_use_release_for_document
-- — SECURITY DEFINER, met p_user_id als parameter, en het verlaagt usage_counters — bereikbaar
-- vanaf elke ingelogde browser via PostgREST.
--
-- Dus bootst de fixture het standaardrecht na, vóór de migraties draaien. Een migratie die alleen
-- van PUBLIC revoket laat de rollen nu staan, en de seam ziet het.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- ═══ [RLS-PROEF] What the mandate migrations need to exist ══════════════════════════════════════
-- Added for invoice_rls_isolation.test.sql, which applies accountant_invoice_mandate.sql and
-- accountant_confirm_mandate.sql — the policies that let an ACCOUNTANT touch a CLIENT's invoices,
-- which is the one cross-tenant surface with real teeth. Same philosophy as the header: exactly
-- the columns those migrations read, and nothing invented.

-- The columns the policies and the amount-guard trigger compare on NEW/OLD.
ALTER TABLE public.invoices
  ADD COLUMN created_by          uuid,
  ADD COLUMN confirmed_by        uuid,
  ADD COLUMN btw_amount          numeric,
  ADD COLUMN total_ex_btw        numeric,
  ADD COLUMN invoice_number      text,
  ADD COLUMN invoice_date        date,
  ADD COLUMN due_date            date,
  ADD COLUMN pay_token           uuid,
  ADD COLUMN payment_prepared_at timestamptz,
  -- [SEAM-KOLOMMEN] The guard grew after this block was written — vendor_iban, payment_reference,
  -- document_id and vat_deduction with the accountant write-hole fixes, discount_type and
  -- discount_value with the discount guard (#290) — and the fixture did not grow with it. The
  -- trigger then failed on the first name it could not find ("record new has no field
  -- vendor_iban"), and the SQL gate has been red on main since, with no test actually asserting
  -- anything. Types are the shipped ones; document_id is a plain uuid here, no FK, for the same
  -- reason invoice_lines.invoice_id has none (see below).
  ADD COLUMN vendor_iban         text,
  ADD COLUMN payment_reference   text,
  ADD COLUMN document_id         uuid,
  ADD COLUMN vat_deduction       text,
  ADD COLUMN discount_type       text,
  ADD COLUMN discount_value      numeric;

CREATE TABLE public.invoice_lines (
  -- invoice_id is a PLAIN uuid, no FK — same as bank_transactions.invoice_id above. A foreign key
  -- here would block the TRUNCATE public.invoices that the seven bank/payment seam tests run, and
  -- this fixture is shared with all of them. The RLS test only needs the join, not the constraint.
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid,
  description text,
  quantity    numeric,
  unit_price  numeric,
  btw_rate    numeric,
  line_total  numeric
);

-- FK target for accountant_invoice_mandates / confirmed_by.
CREATE TABLE public.profiles (
  id   uuid PRIMARY KEY,
  role text
);

-- [ONTVANGEN] The stored file. A production base table (it predates the migrations in this repo,
-- like invoices), stubbed to what the receive-first contracts actually touch: who owns it, which
-- invoice it is evidence for, the state it waits in, and the per-document allowance marker that
-- ontvangen_fair_use_per_document.sql adds a column to. Everything else about a document — the
-- storage path, the size, the hash — is identity that no SQL contract here reasons about.
CREATE TABLE public.documents (
  id                       uuid PRIMARY KEY,
  user_id                  uuid,
  invoice_id               uuid,
  ai_doc_type              text,
  ai_processed             boolean DEFAULT false
);

-- [ONTVANGEN-MELDING] The bell. A production base table, stubbed to what the event-key boundary
-- actually touches: who it is for, and the durable name of the event it reports. The CHECK on
-- `type` and the link column are not part of that contract and are left out on purpose — a stub
-- that copies a production table wholesale becomes a second schema to keep in step.
CREATE TABLE public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid,
  title      text,
  body       text,
  type       text,
  read       boolean DEFAULT false,
  link       text,
  created_at timestamptz DEFAULT now()
);

-- [UREN] The customer card. A production base table (not created by any migration in this repo —
-- it predates them, like invoices), stubbed here to the two columns a foreign key needs: uren
-- point at a client, and the FK is what makes "for whom" a relation instead of a typed-in name.
CREATE TABLE public.clients (
  id      uuid PRIMARY KEY,
  user_id uuid,
  name    text
);

-- The link an accountant must hold BESIDE the mandate — has_active_invoice_mandate joins both.
CREATE TABLE public.accountant_clients (
  accountant_id uuid NOT NULL,
  zzper_id      uuid NOT NULL,
  PRIMARY KEY (accountant_id, zzper_id)
);

-- next_invoice_seq's verkoop-member exception reads these four columns.
CREATE TABLE public.company_members (
  owner_id   uuid NOT NULL,
  member_id  uuid NOT NULL,
  role       text,
  revoked_at timestamptz,
  PRIMARY KEY (owner_id, member_id)
);

-- [OBSERVABILITY] The import skip registry. Present here for one reason: production had RLS ON
-- and NO policy on it, so the panel that exists to prove nothing is silently lost read zero rows
-- and reported "niets overgeslagen" over 324 real ones. The columns are the production ones, no
-- more — this fixture invents nothing.
CREATE TABLE public.email_skipped_attachments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL,
  source_message_id text NOT NULL,
  filename          text,
  reason            text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- RLS ON with no policy is exactly the state that shipped. The migration under test adds the
-- only policy, so anything an impersonated session reaches, it reaches THROUGH that policy.
ALTER TABLE public.email_skipped_attachments ENABLE ROW LEVEL SECURITY;

-- In production RLS on invoices/invoice_lines is ON (enabled outside these migrations, from the
-- original dashboard setup — the base invoices_zzp_* policies are NOT in this repo). Enabling it
-- here means: under the test, ONLY the mandate policies exist, so any row an impersonated session
-- can reach is reached THROUGH the policy under test. The seven existing seam tests run as the
-- superuser table owner, which RLS never applies to, so they are untouched by this.
ALTER TABLE public.invoices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated;

-- ═══ [VRAAG-SYNC] What accountant_write_holes.sql needs to exist ═══════════════════════════════
-- Added for accountant_invoice_question_sync.test.sql, which applies the PRODUCTION write policy on
-- accountant_subject_status (acc_status_owner_write, from accountant_write_holes.sql) before the
-- migration that restricts it to document rows — so the proof that an accountant session cannot
-- write an invoice question row runs against the policy chain production actually has. Two things
-- that policy file touches predate this repo, and are stubbed to exactly what it reads:
--
--   · invoices.shared — the policy's invoice branch reads it, and the file adds a partial index on it;
--   · is_my_accountant_client(uuid) — the dashboard-era SECURITY DEFINER helper the policies call
--     ("is the caller a confirmed accountant of this user"; see scripts/privilege-registry.ts).
--     Stubbed to the join it answers. The fixture's link table carries no confirmation column, so
--     a row IS a confirmed link here — which is the case every test in this file sets up.
ALTER TABLE public.invoices ADD COLUMN shared boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.is_my_accountant_client(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.accountant_clients ac
    WHERE ac.accountant_id = auth.uid() AND ac.zzper_id = p_user_id
  )
$$;
