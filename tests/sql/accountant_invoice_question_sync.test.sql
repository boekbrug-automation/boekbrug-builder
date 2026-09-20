-- migrations: invoice_accountant_status_vocabulary.sql, invoice_accountant_attribution.sql, verwerkt_freeze_level.sql, accountant_subject_status.sql, accountant_write_holes.sql, invoice_questions.sql, accountant_invoice_status_sync.sql, accountant_invoice_question_door_only.sql
-- =====================================================================
-- [VRAAG-SYNC] One accountant + one invoice: the invoice status and the accountant's question row
-- move together, atomically, against a real PostgreSQL.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- ── WHY THIS ONE NEEDS A DATABASE ──
--
-- The claim is "either both facts move or neither does". No TypeScript test can show that: the
-- thing under test is what the database does when the SECOND write inside the function fails after
-- the first one succeeded. Only a real transaction can answer, and only by failing it on purpose.
--
-- The six required cases of the correction (VR-01) are numbered below:
--   1. accountant creates an invoice question → both states are 'vraag'
--   2. the client's answer path cannot close it (no EXECUTE, no UPDATE policy)
--   3. accountant sets the invoice 'verwerkt' → the corresponding question is no longer open
--   4. accountant changes another invoice → no cross-row effect
--   5. another accountant's question on the same invoice → not altered by the wrong accountant
--   6. lifecycle write failure → no half-finished contradictory state
-- =====================================================================

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.t_is(what text, got text, want text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL · % — got %, expected %', what, coalesce(got,'<null>'), coalesce(want,'<null>');
  END IF;
  RAISE NOTICE '  ok · % (%)', what, coalesce(got,'<null>');
END $$;

/** Become a logged-in user: auth.uid() answers their id, exactly as it does for a browser. */
CREATE OR REPLACE FUNCTION public.t_as(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT %L::uuid $f$', u);
END $$;

/** Become the server: auth.uid() is NULL, which is what the service-role key looks like. */
CREATE OR REPLACE FUNCTION public.t_service() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
END $$;

/** Did this statement get refused, and with which message? NULL means it went through. */
CREATE OR REPLACE FUNCTION public.t_refused(stmt text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;

/** The invoice column as it stands, read past any impersonation. */
CREATE OR REPLACE FUNCTION public.t_inv_status(i uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER AS $$ SELECT accountant_status FROM public.invoices WHERE id = i $$;

/** The accountant's question row on an invoice, read past any impersonation. */
CREATE OR REPLACE FUNCTION public.t_q_status(a uuid, i uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT status FROM public.accountant_subject_status
  WHERE accountant_id = a AND subject_type = 'invoice' AND subject_id = i
$$;

/** [6] A way to make the SECOND write inside the function fail on purpose. */
CREATE OR REPLACE FUNCTION public.t_break_question_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('seam.break_question', true) = 'on' THEN
    RAISE EXCEPTION 'seam-break-question';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t_break_question BEFORE INSERT OR UPDATE ON public.accountant_subject_status
  FOR EACH ROW EXECUTE FUNCTION public.t_break_question_write();

/** [6] …and the FIRST one. */
CREATE OR REPLACE FUNCTION public.t_break_invoice_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('seam.break_invoice', true) = 'on' THEN
    RAISE EXCEPTION 'seam-break-invoice';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER t_break_invoice BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.t_break_invoice_write();

-- The roles as Supabase hands them out: table access for the session roles and the server, so
-- that SET ROLE below exercises RLS and EXECUTE the way PostgREST would.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accountant_subject_status, public.invoices, public.accountant_clients TO authenticated, anon;
-- The document branch of acc_status_owner_write looks the document up; a session needs to be able to.
GRANT SELECT ON public.documents TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
-- Supabase creates service_role with BYPASSRLS (`CREATE ROLE service_role NOLOGIN NOINHERIT
-- BYPASSRLS`); the fixture creates a bare role of that name. The function is SECURITY INVOKER, so
-- under SET ROLE service_role below it reads invoices and the question rows with the caller's
-- rights — which in production means past RLS, and here would mean through the stand-in policy
-- with auth.uid() NULL, i.e. nothing. The attribute, not a policy, is what production has.
ALTER ROLE service_role BYPASSRLS;

-- The production `invoices_zzp_*` policies — the owner reads their own invoices — predate this repo
-- and are not in it; the fixture says so and enables RLS on invoices with no owner policy, so that
-- a session reaches a row only through a policy under test. acc_status_client_read_invoice IS under
-- test here, and its EXISTS-subquery on invoices runs under the CLIENT's own RLS: without an owner
-- policy the client sees no invoice, hence no question, and case 2 would measure the fixture
-- instead of the policy. This stand-in is the SELECT half of that production policy, and nothing
-- else in this file reads invoices as a session.
CREATE POLICY t_invoices_owner_read ON public.invoices
  FOR SELECT USING (sender_id = auth.uid() OR receiver_id = auth.uid());

DO $$
DECLARE
  owner_id    uuid := '11111111-1111-1111-1111-111111111111';
  other_owner uuid := '44444444-4444-4444-4444-444444444444';
  acc1        uuid := '22222222-2222-2222-2222-222222222222';
  acc2        uuid := '55555555-5555-5555-5555-555555555555';
  inv1        uuid := '33333333-3333-3333-3333-333333333333';
  inv2        uuid := '66666666-6666-6666-6666-666666666666';
  inv_other   uuid := '77777777-7777-7777-7777-777777777777';
  doc1        uuid := '88888888-8888-8888-8888-888888888888';
  inv3        uuid := '99999999-9999-9999-9999-999999999999';  -- the owner's, never asked about: the direct-INSERT target
  r           record;
  msg         text;
  n           int;
BEGIN
  PERFORM public.t_service();
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices, public.accountant_subject_status, public.accountant_clients, public.documents;
  INSERT INTO public.documents (id, user_id) VALUES (doc1, owner_id);
  DELETE FROM public.profiles;
  INSERT INTO public.profiles (id) VALUES (owner_id), (other_owner), (acc1), (acc2);
  INSERT INTO public.accountant_clients (accountant_id, zzper_id) VALUES (acc1, owner_id), (acc2, owner_id);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv1, owner_id, 'incoming', 'received', 'factuur', 1000, 0),
         (inv2, owner_id, 'incoming', 'received', 'factuur', 500, 0),
         (inv3, owner_id, 'incoming', 'received', 'factuur', 300, 0),
         (inv_other, other_owner, 'incoming', 'received', 'factuur', 200, 0);

  RAISE NOTICE '';
  RAISE NOTICE '— [VRAAG-SYNC] 1. asking writes both facts, with the words —';
  SELECT * INTO r FROM public.accountant_set_invoice_status(acc1, owner_id, inv1, 'vraag', '  Klopt het tarief?  ');
  PERFORM public.t_is('1: invoice status is vraag', public.t_inv_status(inv1), 'vraag');
  PERFORM public.t_is('1: the question row is vraag', public.t_q_status(acc1, inv1), 'vraag');
  PERFORM public.t_is('1: the words are stored, trimmed',
    (SELECT vraag_text FROM public.accountant_subject_status WHERE accountant_id = acc1 AND subject_id = inv1), 'Klopt het tarief?');
  PERFORM public.t_is('1: no attribution on a question', (SELECT accountant_id::text FROM public.invoices WHERE id = inv1), NULL);
  PERFORM public.t_is('1: the previous status is reported', r.previous_status, NULL);
  PERFORM public.t_is('1: no question was open before', r.question_was_open::text, 'false');
  PERFORM public.t_is('1: the question status is reported', r.question_status, 'vraag');
  -- asking again replaces the words and keeps ONE row
  SELECT * INTO r FROM public.accountant_set_invoice_status(acc1, owner_id, inv1, 'vraag', 'Tweede formulering');
  SELECT count(*) INTO n FROM public.accountant_subject_status WHERE accountant_id = acc1 AND subject_id = inv1;
  PERFORM public.t_is('1: re-asking keeps one row', n::text, '1');
  PERFORM public.t_is('1: …with the new words',
    (SELECT vraag_text FROM public.accountant_subject_status WHERE accountant_id = acc1 AND subject_id = inv1), 'Tweede formulering');
  PERFORM public.t_is('1: re-asking reports the question was already open', r.question_was_open::text, 'true');
  -- a question without words is refused, and nothing moves
  UPDATE public.invoices SET accountant_status = NULL WHERE id = inv2;
  msg := public.t_refused(format('SELECT * FROM public.accountant_set_invoice_status(%L, %L, %L, ''vraag'', ''   '')', acc1, owner_id, inv2));
  PERFORM public.t_is('1: a question without words is refused', msg, 'question_required');
  PERFORM public.t_is('1: …and the invoice did not move', public.t_inv_status(inv2), NULL);
  PERFORM public.t_is('1: …and no row was born', public.t_q_status(acc1, inv2), NULL);

  RAISE NOTICE '';
  RAISE NOTICE '— [VRAAG-SYNC] 2. the client cannot close the accountant''s question —';
  -- The client answers through /api/messages; that path never touches this table. What the
  -- database must refuse is the two shortcuts a client could take with the anon key in hand.
  PERFORM public.t_as(owner_id);
  EXECUTE 'SET ROLE authenticated';
  SELECT count(*) INTO n FROM public.accountant_subject_status WHERE subject_id = inv1;
  PERFORM public.t_is('2: the client can READ the question about their own invoice', n::text, '1');
  UPDATE public.accountant_subject_status SET status = 'verwerkt' WHERE subject_id = inv1;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.t_is('2: a direct UPDATE by the client reaches no row (no policy)', n::text, '0');
  msg := public.t_refused(format('SELECT * FROM public.accountant_set_invoice_status(%L, %L, %L, ''verwerkt'', NULL)', acc1, owner_id, inv1));
  PERFORM public.t_is('2: the client cannot call the function', (msg LIKE '%permission denied%')::text, 'true');
  EXECUTE 'RESET ROLE';
  PERFORM public.t_service();
  PERFORM public.t_is('2: the question is still open', public.t_q_status(acc1, inv1), 'vraag');
  PERFORM public.t_is('2: the invoice still says vraag', public.t_inv_status(inv1), 'vraag');
  -- and the anon key on its own
  EXECUTE 'SET ROLE anon';
  msg := public.t_refused(format('SELECT * FROM public.accountant_set_invoice_status(%L, %L, %L, ''verwerkt'', NULL)', acc1, owner_id, inv1));
  PERFORM public.t_is('2: anon cannot call the function', (msg LIKE '%permission denied%')::text, 'true');
  EXECUTE 'RESET ROLE';

  RAISE NOTICE '';
  RAISE NOTICE '— [VRAAG-SYNC] 3. resolving the invoice closes the question in the same action —';
  SELECT * INTO r FROM public.accountant_set_invoice_status(acc1, owner_id, inv1, 'verwerkt', NULL);
  PERFORM public.t_is('3: invoice status is verwerkt', public.t_inv_status(inv1), 'verwerkt');
  PERFORM public.t_is('3: …attributed to the accountant', (SELECT accountant_id::text FROM public.invoices WHERE id = inv1), acc1::text);
  PERFORM public.t_is('3: the question row is no longer open', public.t_q_status(acc1, inv1), 'verwerkt');
  PERFORM public.t_is('3: …and carries the moment it was processed',
    (SELECT (verwerkt_at IS NOT NULL)::text FROM public.accountant_subject_status WHERE accountant_id = acc1 AND subject_id = inv1), 'true');
  PERFORM public.t_is('3: the previous status was vraag', r.previous_status, 'vraag');
  PERFORM public.t_is('3: the caller is told a question was open (so it can say so to the owner)', r.question_was_open::text, 'true');
  PERFORM public.t_is('3: the words stay in the accountant''s archive',
    (SELECT vraag_text FROM public.accountant_subject_status WHERE accountant_id = acc1 AND subject_id = inv1), 'Tweede formulering');
  -- clearing the status leaves the row neutral, never 'vraag' again
  PERFORM public.accountant_set_invoice_status(acc1, owner_id, inv1, NULL, NULL);
  PERFORM public.t_is('3: clearing the invoice status leaves the row neutral', public.t_q_status(acc1, inv1), 'te_verwerken');
  PERFORM public.t_is('3: …and the invoice cleared', public.t_inv_status(inv1), NULL);
  -- an invoice that never had a question: resolving it invents no row
  PERFORM public.accountant_set_invoice_status(acc1, owner_id, inv2, 'in_behandeling', NULL);
  PERFORM public.t_is('3: no question row is invented for an invoice without one', public.t_q_status(acc1, inv2), NULL);

  RAISE NOTICE '';
  RAISE NOTICE '— [VRAAG-SYNC] 4. another invoice is never touched —';
  PERFORM public.accountant_set_invoice_status(acc1, owner_id, inv1, 'vraag', 'Vraag over 1');
  PERFORM public.accountant_set_invoice_status(acc1, owner_id, inv2, 'vraag', 'Vraag over 2');
  PERFORM public.accountant_set_invoice_status(acc1, owner_id, inv1, 'verwerkt', NULL);
  PERFORM public.t_is('4: invoice 1 resolved', public.t_q_status(acc1, inv1), 'verwerkt');
  PERFORM public.t_is('4: invoice 2''s question is still open', public.t_q_status(acc1, inv2), 'vraag');
  PERFORM public.t_is('4: invoice 2''s status still says vraag', public.t_inv_status(inv2), 'vraag');

  RAISE NOTICE '';
  RAISE NOTICE '— [VRAAG-SYNC] 5. another accountant''s question is never altered —';
  PERFORM public.accountant_set_invoice_status(acc2, owner_id, inv1, 'vraag', 'Vraag van de tweede boekhouder');
  PERFORM public.t_is('5: accountant 2 asked', public.t_q_status(acc2, inv1), 'vraag');
  PERFORM public.accountant_set_invoice_status(acc1, owner_id, inv1, 'verwerkt', NULL);
  PERFORM public.t_is('5: accountant 1''s statement moved the invoice', public.t_inv_status(inv1), 'verwerkt');
  PERFORM public.t_is('5: accountant 2''s question is untouched', public.t_q_status(acc2, inv1), 'vraag');
  PERFORM public.t_is('5: accountant 1''s own row is closed', public.t_q_status(acc1, inv1), 'verwerkt');
  PERFORM public.accountant_set_invoice_status(acc2, owner_id, inv1, 'verwerkt', NULL);
  PERFORM public.t_is('5: accountant 2 closes their own', public.t_q_status(acc2, inv1), 'verwerkt');

  RAISE NOTICE '';
  RAISE NOTICE '— [VRAAG-SYNC] 6. a failed second write leaves no contradiction —';
  PERFORM public.accountant_set_invoice_status(acc1, owner_id, inv1, 'vraag', 'Nog een vraag');
  PERFORM public.t_is('6: setup — both say vraag', public.t_inv_status(inv1) || '/' || public.t_q_status(acc1, inv1), 'vraag/vraag');
  -- the question write fails AFTER the invoice write inside the function
  PERFORM set_config('seam.break_question', 'on', true);
  msg := public.t_refused(format('SELECT * FROM public.accountant_set_invoice_status(%L, %L, %L, ''verwerkt'', NULL)', acc1, owner_id, inv1));
  PERFORM set_config('seam.break_question', 'off', true);
  PERFORM public.t_is('6: the action failed as a whole', msg, 'seam-break-question');
  PERFORM public.t_is('6: the invoice write was rolled back with it', public.t_inv_status(inv1), 'vraag');
  PERFORM public.t_is('6: the question is still open', public.t_q_status(acc1, inv1), 'vraag');
  PERFORM public.t_is('6: no attribution leaked', (SELECT accountant_id::text FROM public.invoices WHERE id = inv1), NULL);
  -- and the other way round: the invoice write fails, the question row is not touched
  PERFORM set_config('seam.break_invoice', 'on', true);
  msg := public.t_refused(format('SELECT * FROM public.accountant_set_invoice_status(%L, %L, %L, ''verwerkt'', NULL)', acc1, owner_id, inv1));
  PERFORM set_config('seam.break_invoice', 'off', true);
  PERFORM public.t_is('6: the invoice write refused → the action failed', msg, 'seam-break-invoice');
  PERFORM public.t_is('6: the question row did not move either', public.t_q_status(acc1, inv1), 'vraag');
  -- with the breakers off, the same call succeeds — the breakers were the only difference
  PERFORM public.accountant_set_invoice_status(acc1, owner_id, inv1, 'verwerkt', NULL);
  PERFORM public.t_is('6: the same call succeeds once the write can complete', public.t_inv_status(inv1) || '/' || public.t_q_status(acc1, inv1), 'verwerkt/verwerkt');

  RAISE NOTICE '';
  RAISE NOTICE '— [VRAAG-SYNC] scope: the function refuses on its own, whatever the caller checked —';
  msg := public.t_refused(format('SELECT * FROM public.accountant_set_invoice_status(%L, %L, %L, ''verwerkt'', NULL)', acc1, other_owner, inv_other));
  PERFORM public.t_is('an accountant not linked to the client is refused', msg, 'not_linked');
  PERFORM public.t_is('…and nothing moved', public.t_inv_status(inv_other), NULL);
  msg := public.t_refused(format('SELECT * FROM public.accountant_set_invoice_status(%L, %L, %L, ''verwerkt'', NULL)', acc1, owner_id, inv_other));
  PERFORM public.t_is('an invoice of another client is refused', msg, 'invoice_not_this_client');
  PERFORM public.t_is('…and nothing moved', public.t_inv_status(inv_other), NULL);
  msg := public.t_refused(format('SELECT * FROM public.accountant_set_invoice_status(%L, %L, %L, ''afgekeurd'', NULL)', acc1, owner_id, inv1));
  PERFORM public.t_is('a word outside the vocabulary is refused', msg, 'unknown_status');
  PERFORM public.t_is('…and nothing moved', public.t_inv_status(inv1), 'verwerkt');

  RAISE NOTICE '';
  RAISE NOTICE '— [VRAAG-SYNC] the server may call it; the door''s trigger still refuses every session —';
  EXECUTE 'SET ROLE service_role';
  PERFORM public.accountant_set_invoice_status(acc1, owner_id, inv1, 'in_behandeling', NULL);
  EXECUTE 'RESET ROLE';
  PERFORM public.t_is('service_role may call the function', public.t_inv_status(inv1), 'in_behandeling');
  PERFORM public.t_is('…and the question row followed', public.t_q_status(acc1, inv1), 'in_behandeling');
  PERFORM public.t_as(acc1);
  msg := public.t_refused(format('UPDATE public.invoices SET accountant_status = ''verwerkt'' WHERE id = %L', inv1));
  PERFORM public.t_is('an accountant session still cannot write the column directly', (msg IS NOT NULL)::text, 'true');
  PERFORM public.t_service();

  -- ── 7. The OTHER door: the accountant's own session against accountant_subject_status ───────
  -- The function above is the one application write path, but RLS is what the anon key in every
  -- browser talks to. acc_status_owner_write (accountant_write_holes.sql, applied here exactly as
  -- production has it) allowed an accountant session to insert, update, delete or move an INVOICE
  -- question row directly — without moving invoices.accountant_status in the same transaction.
  -- accountant_invoice_question_door_only.sql restricts that policy to document rows. What must
  -- hold: the document workflow (/api/accountant/subject-status) still writes with the session;
  -- an invoice question row cannot be touched by any session; every read path is unchanged; the
  -- server's function still does everything, and still all-or-nothing.
  RAISE NOTICE '';
  RAISE NOTICE '— [VRAAG-SYNC] 7. the accountant''s direct write path: open for documents, closed for invoices —';
  PERFORM public.accountant_set_invoice_status(acc1, owner_id, inv1, 'vraag', 'Nog open');
  PERFORM public.t_is('7: setup — an invoice question is open (written by the function)', public.t_q_status(acc1, inv1), 'vraag');
  PERFORM public.t_as(acc1);
  EXECUTE 'SET ROLE authenticated';
  -- 7a · documents: the session still writes its own status rows, over a linked client's document
  INSERT INTO public.accountant_subject_status (accountant_id, subject_type, subject_id, status, vraag_text)
  VALUES (acc1, 'document', doc1, 'vraag', 'Welke bon hoort hierbij?');
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.t_is('7a: the accountant INSERTs a document status row directly', n::text, '1');
  UPDATE public.accountant_subject_status SET status = 'verwerkt', verwerkt_at = now()
  WHERE accountant_id = acc1 AND subject_type = 'document' AND subject_id = doc1;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.t_is('7a: …and UPDATEs it directly (the document workflow is unchanged)', n::text, '1');
  -- 7b · the read paths are untouched: the accountant sees their own document AND invoice rows
  PERFORM public.t_is('7b: the accountant still reads their own archive — the document row and both invoice rows',
    (SELECT count(*) FILTER (WHERE subject_type = 'document') || '/' || count(*) FILTER (WHERE subject_type = 'invoice') FROM public.accountant_subject_status WHERE accountant_id = acc1), '1/2');
  -- 7c · an invoice question row cannot be INSERTed by the session
  msg := public.t_refused(format(
    'INSERT INTO public.accountant_subject_status (accountant_id, subject_type, subject_id, status, vraag_text) VALUES (%L, ''invoice'', %L, ''vraag'', ''Direct'')', acc1, inv3));
  PERFORM public.t_is('7c: a direct INSERT of an invoice question row is refused by RLS', (msg LIKE '%row-level security%')::text, 'true');
  PERFORM public.t_is('7c: …and nothing was born', (SELECT count(*)::text FROM public.accountant_subject_status WHERE subject_type = 'invoice' AND subject_id = inv3), '0');
  -- 7d · the existing invoice question row cannot be UPDATEd by the session: its status, its words
  UPDATE public.accountant_subject_status SET status = 'verwerkt', verwerkt_at = now()
  WHERE accountant_id = acc1 AND subject_type = 'invoice' AND subject_id = inv1;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.t_is('7d: a direct UPDATE of the invoice question''s status reaches no row', n::text, '0');
  UPDATE public.accountant_subject_status SET vraag_text = 'Herschreven'
  WHERE accountant_id = acc1 AND subject_type = 'invoice' AND subject_id = inv1;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.t_is('7d: …nor its words', n::text, '0');
  -- 7e · nor DELETEd or moved — and a document row cannot be turned INTO an invoice row
  DELETE FROM public.accountant_subject_status WHERE accountant_id = acc1 AND subject_type = 'invoice' AND subject_id = inv1;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.t_is('7e: a direct DELETE reaches no row', n::text, '0');
  UPDATE public.accountant_subject_status SET subject_id = inv3
  WHERE accountant_id = acc1 AND subject_type = 'invoice' AND subject_id = inv1;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.t_is('7e: a move to another invoice reaches no row', n::text, '0');
  msg := public.t_refused(format(
    'UPDATE public.accountant_subject_status SET subject_type = ''invoice'', subject_id = %L WHERE accountant_id = %L AND subject_type = ''document'' AND subject_id = %L', inv1, acc1, doc1));
  PERFORM public.t_is('7e: turning a document row into an invoice row is refused by RLS', (msg LIKE '%row-level security%')::text, 'true');
  EXECUTE 'RESET ROLE';
  PERFORM public.t_service();
  PERFORM public.t_is('7e: the invoice question row is exactly as the function left it', public.t_q_status(acc1, inv1) || '/' || (SELECT vraag_text FROM public.accountant_subject_status WHERE accountant_id = acc1 AND subject_type = 'invoice' AND subject_id = inv1), 'vraag/Nog open');
  PERFORM public.t_is('7e: …and the invoice still says vraag', public.t_inv_status(inv1), 'vraag');
  -- 7f · the second linked accountant cannot touch the first one's invoice row either
  PERFORM public.t_as(acc2);
  EXECUTE 'SET ROLE authenticated';
  UPDATE public.accountant_subject_status SET status = 'verwerkt' WHERE subject_type = 'invoice' AND subject_id = inv1;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.t_is('7f: another linked accountant reaches no row of the first one', n::text, '0');
  msg := public.t_refused(format(
    'INSERT INTO public.accountant_subject_status (accountant_id, subject_type, subject_id, status, vraag_text) VALUES (%L, ''invoice'', %L, ''vraag'', ''Direct'')', acc2, inv3));
  PERFORM public.t_is('7f: …and cannot insert their own invoice question row directly either', (msg LIKE '%row-level security%')::text, 'true');
  EXECUTE 'RESET ROLE';
  -- 7g · the client/owner stays read-only, exactly as in case 2, with the restricted policy in place
  PERFORM public.t_as(owner_id);
  EXECUTE 'SET ROLE authenticated';
  -- Both offices asked about this invoice (case 5), and the owner reads both — VR-02's premise.
  SELECT count(*) INTO n FROM public.accountant_subject_status WHERE subject_id = inv1;
  PERFORM public.t_is('7g: the owner still READs the questions about their invoice — one per asking office', n::text, '2');
  UPDATE public.accountant_subject_status SET status = 'verwerkt' WHERE subject_id = inv1;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.t_is('7g: …and reaches no row with an UPDATE', n::text, '0');
  DELETE FROM public.accountant_subject_status WHERE subject_id = inv1;
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM public.t_is('7g: …nor with a DELETE', n::text, '0');
  msg := public.t_refused(format(
    'INSERT INTO public.accountant_subject_status (accountant_id, subject_type, subject_id, status, vraag_text) VALUES (%L, ''invoice'', %L, ''vraag'', ''Van de klant'')', acc1, inv3));
  PERFORM public.t_is('7g: …and an INSERT is refused', (msg LIKE '%row-level security%')::text, 'true');
  EXECUTE 'RESET ROLE';
  -- 7h · the server's function, as service_role, still asks and resolves — and still all-or-nothing
  PERFORM public.t_service();
  EXECUTE 'SET ROLE service_role';
  PERFORM public.accountant_set_invoice_status(acc1, owner_id, inv1, 'verwerkt', NULL);
  PERFORM public.t_is('7h: service_role resolves through the function: the question closed', public.t_q_status(acc1, inv1), 'verwerkt');
  PERFORM public.t_is('7h: …and the invoice moved with it', public.t_inv_status(inv1), 'verwerkt');
  PERFORM public.accountant_set_invoice_status(acc1, owner_id, inv2, 'vraag', 'Nieuwe vraag');
  PERFORM public.t_is('7h: service_role asks through the function: the row is born', public.t_q_status(acc1, inv2), 'vraag');
  PERFORM set_config('seam.break_question', 'on', true);
  msg := public.t_refused(format('SELECT * FROM public.accountant_set_invoice_status(%L, %L, %L, ''verwerkt'', NULL)', acc1, owner_id, inv2));
  PERFORM set_config('seam.break_question', 'off', true);
  PERFORM public.t_is('7h: a failed question write fails the whole action', msg, 'seam-break-question');
  PERFORM public.t_is('7h: …and the invoice write was rolled back with it', public.t_inv_status(inv2) || '/' || public.t_q_status(acc1, inv2), 'vraag/vraag');
  PERFORM set_config('seam.break_invoice', 'on', true);
  msg := public.t_refused(format('SELECT * FROM public.accountant_set_invoice_status(%L, %L, %L, ''verwerkt'', NULL)', acc1, owner_id, inv2));
  PERFORM set_config('seam.break_invoice', 'off', true);
  PERFORM public.t_is('7h: a failed invoice write fails the whole action', msg, 'seam-break-invoice');
  PERFORM public.t_is('7h: …and the question row did not move either', public.t_inv_status(inv2) || '/' || public.t_q_status(acc1, inv2), 'vraag/vraag');
  EXECUTE 'RESET ROLE';
  -- and the policy set is exactly the four production names, with no FOR ALL survivor from the repo's first version
  PERFORM public.t_is('7: the policy set on accountant_subject_status',
    (SELECT string_agg(policyname || ':' || cmd, ' ' ORDER BY policyname) FROM pg_policies WHERE tablename = 'accountant_subject_status'),
    'acc_status_client_read_document:SELECT acc_status_client_read_invoice:SELECT acc_status_owner_read:SELECT acc_status_owner_write:ALL');
  PERFORM public.t_is('7: the write policy names document rows only',
    ((SELECT qual FROM pg_policies WHERE tablename = 'accountant_subject_status' AND policyname = 'acc_status_owner_write') LIKE '%subject_type = ''document''%'
     AND (SELECT qual FROM pg_policies WHERE tablename = 'accountant_subject_status' AND policyname = 'acc_status_owner_write') NOT LIKE '%invoice%')::text, 'true');
END $$;

SELECT '[VRAAG-SYNC] held: asking writes both facts; the client can read and never close; resolving closes the accountant''s own question in the same transaction; other invoices and other accountants are untouched; a failed second write rolls the first one back; and no session — accountant or client — can write an invoice question row past the function, while the document workflow still writes with the session' AS result;
