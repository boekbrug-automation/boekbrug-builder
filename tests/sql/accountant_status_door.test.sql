-- migrations: invoice_accountant_status_vocabulary.sql, invoice_accountant_attribution.sql, verwerkt_freeze_level.sql
-- =====================================================================
-- [BOEKHOUDER-DEUR] accountant_status has ONE write path, against a real PostgreSQL.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- ── WHY THIS ONE NEEDS A DATABASE ──
--
-- The claim is not "the screen calls a route". It is "a direct client mutation CANNOT change this
-- column" — and nothing in TypeScript can show that, because the thing being tested is what the
-- database does to a write the application never makes. A grep proving the page no longer contains
-- .update({ accountant_status }) proves the page; it says nothing about the anon key in the browser
-- bundle, which can reach /rest/v1/invoices directly.
--
-- So every assertion below is a real UPDATE, against the real trigger, under a real auth.uid().
--
-- ── HOW A BROWSER IS IMPERSONATED ──
--
-- Supabase distinguishes callers by auth.uid(): NULL for the service-role key, the user's id for
-- every session and for the anon key. The fixture stubs auth.uid() to NULL, so t_as() redefines it
-- to return an id — that IS a session, as far as every policy and trigger in this app can tell.
-- t_service() puts it back.
-- =====================================================================

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.t_ok(what text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN RAISE NOTICE '  ok · %', what; END $$;

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

/** The column as it now stands. Read through a SECURITY DEFINER so impersonation cannot hide it. */
CREATE OR REPLACE FUNCTION public.t_service_status(i uuid) RETURNS text
LANGUAGE sql SECURITY DEFINER AS $$ SELECT accountant_status FROM public.invoices WHERE id = i $$;

/** Did this statement get refused, and with which message? NULL means it went through. */
CREATE OR REPLACE FUNCTION public.t_refused(stmt text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END $$;

DO $$
DECLARE
  owner_id   uuid := '11111111-1111-1111-1111-111111111111';
  acc_id     uuid := '22222222-2222-2222-2222-222222222222';
  inv        uuid := '33333333-3333-3333-3333-333333333333';
  msg        text;
  upd_msg    text;
BEGIN
  PERFORM public.t_service();
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  DELETE FROM public.profiles;
  INSERT INTO public.profiles (id) VALUES (owner_id), (acc_id);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, owner_id, 'incoming', 'received', 'factuur', 1000, 0);

  RAISE NOTICE '';
  RAISE NOTICE '— [BOEKHOUDER-DEUR] a direct client write cannot touch the column —';

  -- 1 + 2 + 7: the owner of the invoice is a session like any other, and the lock is not theirs
  -- to set. This is the write the quarter screen used to make from the browser.
  PERFORM public.t_as(owner_id);
  msg := public.t_refused(format('UPDATE public.invoices SET accountant_status = ''verwerkt'' WHERE id = %L', inv));
  upd_msg := msg;
  PERFORM public.t_is('the invoice owner is refused', (msg IS NOT NULL)::text, 'true');
  PERFORM public.t_is('…and the column did not move', public.t_service_status(inv), NULL);

  -- 8: the accountant is a session too. Authorization lives in the door, not in the table — the
  -- database's job here is only that NO session may write, whoever they are.
  PERFORM public.t_as(acc_id);
  msg := public.t_refused(format('UPDATE public.invoices SET accountant_status = ''verwerkt'' WHERE id = %L', inv));
  PERFORM public.t_is('an accountant session is refused too', (msg IS NOT NULL)::text, 'true');

  -- 5: and the attribution cannot be forged from a session either.
  msg := public.t_refused(format('UPDATE public.invoices SET accountant_id = %L WHERE id = %L', acc_id, inv));
  PERFORM public.t_is('a forged accountant_id is refused', (msg IS NOT NULL)::text, 'true');

  -- An INSERT is a write too. A row may not be born locked.
  msg := public.t_refused(format(
    'INSERT INTO public.invoices (id, receiver_id, direction, status, accountant_status) VALUES (%L, %L, ''incoming'', ''received'', ''verwerkt'')',
    '44444444-4444-4444-4444-444444444444'::uuid, owner_id));
  PERFORM public.t_is('a session cannot insert a row already locked', (msg IS NOT NULL)::text, 'true');

  -- The refusal must not be readable as the accountant lock. Fourteen callers triage money errors
  -- by substring and eight of them look for exactly this word; a door refusal containing it would
  -- be reported to the owner as "your accountant has processed this invoice".
  --
  -- BOTH messages, and that is not belt-and-braces: a mutation that reworded only the UPDATE
  -- refusal survived a version of this test that checked only the INSERT one. Two messages, two
  -- assertions — a door with two mouths can lie with either.
  PERFORM public.t_is('the UPDATE refusal never says the lock''s name',
    (lower(upd_msg) LIKE '%verwerkt%')::text, 'false');
  PERFORM public.t_is('the INSERT refusal never says it either',
    (lower(msg) LIKE '%verwerkt%')::text, 'false');

  RAISE NOTICE '';
  RAISE NOTICE '— [BOEKHOUDER-DEUR] the server door writes, and the undo it must keep —';

  -- 3 + 4: the door's write. auth.uid() NULL is the service-role client the door uses.
  PERFORM public.t_service();
  UPDATE public.invoices SET accountant_status = 'verwerkt', accountant_id = acc_id WHERE id = inv;
  PERFORM public.t_is('the door may set the lock', public.t_service_status(inv), 'verwerkt');
  PERFORM public.t_is('…attributed to the accountant who asserted it',
    (SELECT accountant_id::text FROM public.invoices WHERE id = inv), acc_id::text);

  -- 10: prevent_verwerkt_invoice_changes is loaded and the lock stands — and the undo still works.
  -- This is the requirement that the column must NOT be frozen: undo is a legal operation.
  UPDATE public.invoices SET accountant_status = NULL, accountant_id = NULL WHERE id = inv;
  PERFORM public.t_is('the undo is not blocked by the freeze', public.t_service_status(inv), NULL);
  PERFORM public.t_is('…and the attribution goes with it',
    (SELECT accountant_id::text FROM public.invoices WHERE id = inv), NULL);

  -- And the freeze itself is untouched: with the lock standing, money still cannot move.
  UPDATE public.invoices SET accountant_status = 'verwerkt', accountant_id = acc_id WHERE id = inv;
  PERFORM public.t_as(owner_id);
  msg := public.t_refused(format('UPDATE public.invoices SET amount_paid = 1000, status = ''paid'' WHERE id = %L', inv));
  PERFORM public.t_is('the money freeze still holds while locked', (msg IS NOT NULL)::text, 'true');
  PERFORM public.t_service();

  RAISE NOTICE '';
  RAISE NOTICE '— [VERWERKT-WOORDENLIJST] the vocabulary is enforced by the database —';
  msg := public.t_refused(format('UPDATE public.invoices SET accountant_status = ''afgekeurd'' WHERE id = %L', inv));
  PERFORM public.t_is('a word outside the vocabulary is refused', (msg IS NOT NULL)::text, 'true');
END $$;

SELECT '[BOEKHOUDER-DEUR] held: no session may write accountant_status or its actor, the server door may, the deliberate undo survives the freeze, the money freeze still holds, and the vocabulary is enforced' AS result;
