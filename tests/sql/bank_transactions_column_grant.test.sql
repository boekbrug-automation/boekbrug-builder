-- migrations: bank_tx_invoices.sql, invoice_partial_payments.sql, bank_transactions_column_grant.sql
-- =====================================================================
-- [KOLOMRECHT] A session writes three columns on bank_transactions, and no others.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- RLS scopes ROWS. The columns that carry a line's allocation state — invoice_id and status — sat
-- inside the same row the owner may legitimately edit for categorisation, so owning the row meant
-- owning those two as well. A column-scoped UPDATE grant sits UNDER the policy rather than beside
-- it, and this file proves both halves still apply, by experiment.
--
-- Every refusal below is paired with something that must still succeed. A harness that refuses
-- everything — role unbound, grants dropped wholesale, RLS misconfigured — fails on the positive
-- controls first, rather than reporting a clean boundary.
--
-- The asymmetry worth knowing, and the reason assertion 3 is written on the OUTCOME: PostgreSQL
-- enforces a missing COLUMN privilege by raising 42501, but a row the policy does not admit is
-- simply not visible to the UPDATE, so that statement succeeds having changed nothing.

\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
\set U '11111111-1111-1111-1111-111111111111'
\set X '99999999-9999-9999-9999-999999999999'

-- The two BASE policies this table has in production are in no migration — they came from the
-- original dashboard setup, exactly like the invoices base policies (see invoice_rls_isolation).
-- The migration under test deliberately does not create them; it narrows UPDATE and removes DELETE.
-- So the fixture supplies them here, and says so, rather than the test quietly proving less.
DROP POLICY IF EXISTS bank_transactions_select_own ON public.bank_transactions;
CREATE POLICY bank_transactions_select_own ON public.bank_transactions
  FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
DROP POLICY IF EXISTS bank_transactions_insert_own ON public.bank_transactions;
CREATE POLICY bank_transactions_insert_own ON public.bank_transactions
  FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));

TRUNCATE public.invoices, public.invoice_lines, public.bank_transactions, public.bank_tx_invoices;
INSERT INTO public.profiles (id, role) VALUES (:'U','zzper'), (:'X','zzper') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.invoices (id, receiver_id, direction, invoice_type, status, total_inc_btw, amount_paid)
VALUES ('a0000000-0000-0000-0000-000000000ca1', :'U', 'incoming', 'factuur', 'received', 500, 0);
INSERT INTO public.bank_transactions (id, user_id, amount, date, status, invoice_id, category) VALUES
  ('ba000000-0000-0000-0000-000000000ca1', :'U', -500, '2026-03-01', 'pending', NULL, 'kosten'),
  ('ba000000-0000-0000-0000-000000000ca2', :'X', -200, '2026-03-01', 'pending', NULL, 'kosten');

-- ═══ 0. The shape this migration leaves behind ═══════════════════════════════════════════════════
DO $$
DECLARE pols text; cols text;
BEGIN
  SELECT string_agg(polname||':'||polcmd::text, ', ' ORDER BY polname) INTO pols
  FROM pg_policy WHERE polrelid='public.bank_transactions'::regclass;
  IF pols IS DISTINCT FROM 'bank_transactions_insert_own:a, bank_transactions_select_own:r, bank_transactions_update_own:w' THEN
    RAISE EXCEPTION '[KOLOMRECHT] policy set is "%" — expected insert/select/update own and NO delete', pols;
  END IF;
  SELECT string_agg(column_name, ',' ORDER BY column_name) INTO cols
  FROM information_schema.column_privileges
  WHERE table_schema='public' AND table_name='bank_transactions'
    AND grantee='authenticated' AND privilege_type='UPDATE';
  IF cols IS DISTINCT FROM 'category,category_confirmed,category_source' THEN
    RAISE EXCEPTION '[KOLOMRECHT] the session may UPDATE "%" — expected exactly the three category columns', cols;
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.bank_transactions'::regclass) THEN
    RAISE EXCEPTION '[KOLOMRECHT] row level security is OFF — the ownership policy is decoration';
  END IF;
  RAISE NOTICE '  ok · three policies (no delete), and UPDATE granted on exactly the three category columns';
END $$;

-- ═══ 1. As a logged-in session ══════════════════════════════════════════════════════════════════
SELECT set_config('test.uid', :'U', false);
SET ROLE authenticated;

DO $$
DECLARE n int; failed boolean; col text; mine uuid := 'ba000000-0000-0000-0000-000000000ca1';
        theirs uuid := 'ba000000-0000-0000-0000-000000000ca2';
BEGIN
  -- CONTROL FIRST: if the read or the legitimate write is broken, nothing below proves anything.
  SELECT count(*) INTO n FROM public.bank_transactions;
  IF n <> 1 THEN RAISE EXCEPTION '[KOLOMRECHT] the owner sees % rows, expected only their own', n; END IF;

  UPDATE public.bank_transactions
     SET category='reiskosten', category_source='user', category_confirmed=true
   WHERE id = mine;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION '[KOLOMRECHT] the categorise screen can no longer write (% rows)', n; END IF;
  IF (SELECT category FROM public.bank_transactions WHERE id=mine) <> 'reiskosten' THEN
    RAISE EXCEPTION '[KOLOMRECHT] the category write reported success and changed nothing';
  END IF;
  RAISE NOTICE '  ok · the session still writes category, category_source and category_confirmed';

  -- The ownership policy is unchanged: another user's row is not reachable, even on a granted column.
  UPDATE public.bank_transactions SET category='gestolen' WHERE id = theirs;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION '[KOLOMRECHT] a session wrote % row(s) of ANOTHER user', n; END IF;
  IF (SELECT category FROM public.bank_transactions WHERE id=theirs) <> 'kosten' THEN
    RAISE EXCEPTION '[KOLOMRECHT] another user''s row changed';
  END IF;
  RAISE NOTICE '  ok · update_own still filters: another user''s row is untouched (0 rows, not an error)';

  -- The protected columns, one at a time, each on the owner's OWN row.
  FOREACH col IN ARRAY ARRAY['invoice_id','status','amount','date','user_id'] LOOP
    failed := false;
    BEGIN
      EXECUTE format('UPDATE public.bank_transactions SET %I = %L WHERE id = %L', col,
        CASE col WHEN 'invoice_id' THEN 'a0000000-0000-0000-0000-000000000ca1'
                 WHEN 'status' THEN 'matched' WHEN 'amount' THEN '-1'
                 WHEN 'date' THEN '2026-01-01'
                 ELSE '99999999-9999-9999-9999-999999999999' END, mine);
    EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
    IF NOT failed THEN
      RAISE EXCEPTION '[KOLOMRECHT] a session wrote the protected column % on its own row', col;
    END IF;
  END LOOP;
  RAISE NOTICE '  ok · invoice_id, status, amount, date and user_id are each refused (42501)';

  -- And a statement that hides a protected column behind a granted one is refused whole.
  failed := false;
  BEGIN
    UPDATE public.bank_transactions
       SET category='x', invoice_id='a0000000-0000-0000-0000-000000000ca1' WHERE id = mine;
  EXCEPTION WHEN insufficient_privilege THEN failed := true; END;
  IF NOT failed THEN RAISE EXCEPTION '[KOLOMRECHT] a MIXED update smuggled invoice_id past the grant'; END IF;
  RAISE NOTICE '  ok · a mixed update naming category AND invoice_id is refused whole';

  -- DELETE has no policy any more, so it is filtered to nothing rather than raising.
  DELETE FROM public.bank_transactions WHERE id = mine;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION '[KOLOMRECHT] a session DELETED % bank line(s)', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bank_transactions WHERE id=mine) THEN
    RAISE EXCEPTION '[KOLOMRECHT] the bank line is gone after a session DELETE';
  END IF;
  RAISE NOTICE '  ok · a session DELETE removes no bank line (filtered, not raised)';
END $$;

-- ═══ 2. The doors are unaffected, called by that same session ════════════════════════════════════
-- Without this, "a session cannot set invoice_id" would also pass on a database where nothing can.
DO $$
DECLARE r record; st text; inv uuid;
BEGIN
  SELECT * INTO r FROM public.apply_bank_payment(
    '11111111-1111-1111-1111-111111111111'::uuid,
    'ba000000-0000-0000-0000-000000000ca1'::uuid,
    'a0000000-0000-0000-0000-000000000ca1'::uuid, 500, '2026-03-01'::date);
  IF r.applied IS DISTINCT FROM 500 THEN RAISE EXCEPTION '[KOLOMRECHT] the door did not book: %', r.applied; END IF;
  SELECT status, invoice_id INTO st, inv FROM public.bank_transactions WHERE id='ba000000-0000-0000-0000-000000000ca1';
  IF st IS DISTINCT FROM 'matched' OR inv IS DISTINCT FROM 'a0000000-0000-0000-0000-000000000ca1'::uuid THEN
    RAISE EXCEPTION '[KOLOMRECHT] the door could not set status/invoice_id: % / %', st, inv;
  END IF;
  RAISE NOTICE '  ok · a SECURITY DEFINER door still sets status and invoice_id for the same session';
END $$;

RESET ROLE;
SELECT set_config('test.uid', '', false);

SELECT '[KOLOMRECHT] held: a session writes only the three category columns, only on its own rows, cannot delete a line, and the payment doors still set status and invoice_id for that same session' AS result;
