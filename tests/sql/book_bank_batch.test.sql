-- migrations: book_bank_batch_atomic.sql, bank_confirm_atomic.sql, rpc_anon_revoke.sql
-- =====================================================================
-- [SEAM] book_bank_batch, against a real PostgreSQL.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- BOTH migrations are loaded, in the order a deployment applies them, because BOTH define this
-- function and whichever runs last wins. That is not a detail: the second file added the tie
-- re-proof, so applying them the other way round used to remove it again, silently. The bodies are
-- now kept identical and this file proves it by running the pair.
--
-- ── WHAT THIS FOUND ──
--
-- book_bank_batch raised on EVERY call:
--
--     column reference "invoice_id" is ambiguous
--
-- RETURNS TABLE(invoice_id uuid) declares a plpgsql variable of that name, and step (3) says
-- ON CONFLICT (transaction_id, invoice_id). plpgsql refuses to guess which one is meant. The
-- simplest possible input reproduces it: two invoices tying exactly to the line.
--
-- The caller answers a raise with `if (batchErr) continue`, under a comment reading "error ⇒ not
-- payable / migration not applied ⇒ the batch stays for the human". So the failure looked like a
-- normal outcome, every run, forever. Multi-invoice auto-confirmation had never booked anything —
-- and no test could see it, because every test of that path stops at the pure planner.
-- =====================================================================

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.t_eq(what text, got numeric, want numeric) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL · % — got %, expected %', what, got, want;
  END IF;
  RAISE NOTICE '  ok · % (%)', what, got;
END $$;

CREATE OR REPLACE FUNCTION public.t_is(what text, got text, want text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL · % — got %, expected %', what, got, want;
  END IF;
  RAISE NOTICE '  ok · % (%)', what, got;
END $$;

/** Did this call raise? Run it in its own subtransaction so the caller's data survives. */
CREATE OR REPLACE FUNCTION public.t_batch_refuses(u uuid, tx uuid, ids uuid[]) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.book_bank_batch(u, tx, ids, DATE '2026-08-07');
  RETURN false;
EXCEPTION WHEN sqlstate '55000' OR sqlstate '22023' THEN
  RETURN true;
END $$;

\echo ''
\echo '— [BANK-BATCH] the simplest batch there is — and it used to raise —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        c uuid := 'cccccccc-0000-0000-0000-00000000000c';
        d uuid := 'dddddddd-0000-0000-0000-00000000000d';
BEGIN
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.bank_transactions VALUES (tx, u, -1000, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (c, u, 'incoming', 'received', 'factuur', 600, 0),
         (d, u, 'incoming', 'received', 'factuur', 400, 0);

  PERFORM public.t_eq('two invoices come back',
    (SELECT count(*) FROM public.book_bank_batch(u, tx, ARRAY[c, d], DATE '2026-08-07')), 2);
  PERFORM public.t_is('both are paid',
    (SELECT string_agg(DISTINCT status, ',') FROM public.invoices), 'paid');
  PERFORM public.t_eq('each amount_paid is its own total',
    (SELECT sum(amount_paid) FROM public.invoices), 1000);
  PERFORM public.t_eq('and Σ amount_applied equals the line',
    (SELECT sum(amount_applied) FROM public.bank_tx_invoices WHERE transaction_id = tx), 1000);
  PERFORM public.t_is('the line is matched',
    (SELECT status FROM public.bank_transactions WHERE id = tx), 'matched');
  PERFORM public.t_is('carrying the last id as its representative',
    (SELECT invoice_id::text FROM public.bank_transactions WHERE id = tx), d::text);
END $$;

\echo ''
\echo '— [BANK-BATCH-TIE-LOCKED] a tie that no longer ties aborts everything —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        c uuid := 'cccccccc-0000-0000-0000-00000000000c';
        d uuid := 'dddddddd-0000-0000-0000-00000000000d';
BEGIN
  -- The caller planned against a snapshot; an instalment landed on C in between. The batch's whole
  -- justification is that the open amounts sum to the line to the cent, so a broken tie is not a
  -- smaller batch — it is a plan about a world that has moved.
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.bank_transactions VALUES (tx, u, -1000, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (c, u, 'incoming', 'received', 'factuur', 600, 250),
         (d, u, 'incoming', 'received', 'factuur', 400, 0);

  PERFORM public.t_is('the batch is refused', public.t_batch_refuses(u, tx, ARRAY[c, d])::text, 'true');
  PERFORM public.t_eq('nothing was booked', (SELECT count(*) FROM public.bank_tx_invoices), 0);
  PERFORM public.t_is('and the line is still the human''s to deal with',
    (SELECT status FROM public.bank_transactions WHERE id = tx), 'pending');
END $$;

\echo ''
\echo '— [BANK-BATCH-ELDERS] the tie is against what the line STILL HAS —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        a uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
        c uuid := 'cccccccc-0000-0000-0000-00000000000c';
        d uuid := 'dddddddd-0000-0000-0000-00000000000d';
BEGIN
  -- A bank line stays 'pending' precisely WHILE part of it is spent — confirm_bank_payment leaves
  -- it so. The tie compared the plan against the line's face amount and ignored those euros, so a
  -- EUR 1.000 debit with EUR 400 already booked accepted a EUR 1.000 batch and ended with
  -- Σ amount_applied = 1.400. That is the same euros booked twice, which is the exact state
  -- [BANK-OVERAPPLIED-LOUD] exists to shout about after the fact.
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.bank_transactions VALUES (tx, u, -1000, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (a, u, 'incoming', 'paid',     'factuur', 400, 400),
         (c, u, 'incoming', 'received', 'factuur', 600, 0),
         (d, u, 'incoming', 'received', 'factuur', 400, 0);
  INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id, amount_applied)
  VALUES (u, tx, a, 400);

  PERFORM public.t_is('a batch of 1.000 against the 600 that is left is refused',
    public.t_batch_refuses(u, tx, ARRAY[c, d])::text, 'true');
  PERFORM public.t_eq('so the line still carries only its 400',
    (SELECT sum(amount_applied) FROM public.bank_tx_invoices WHERE transaction_id = tx), 400);

  -- And a batch that DOES fit the remainder books normally.
  UPDATE public.invoices SET total_inc_btw = 350 WHERE id = c;
  UPDATE public.invoices SET total_inc_btw = 250 WHERE id = d;
  PERFORM public.book_bank_batch(u, tx, ARRAY[c, d], DATE '2026-08-07');
  PERFORM public.t_eq('600 + the earlier 400 is the whole line',
    (SELECT sum(amount_applied) FROM public.bank_tx_invoices WHERE transaction_id = tx), 1000);
END $$;

\echo ''
\echo '— [BANK-BATCH-ELDERS] an invoice this line already partly paid keeps its invariant —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        c uuid := 'cccccccc-0000-0000-0000-00000000000c';
        d uuid := 'dddddddd-0000-0000-0000-00000000000d';
BEGIN
  -- C already has EUR 200 from THIS line. Two things have to be true at once, and the first
  -- version of this fix got the second wrong.
  --
  --   · Those EUR 200 are SPENT from the line. Counting only the links to invoices OUTSIDE the
  --     batch left them out, and the batch then spent them a second time — measured at
  --     Σ amount_applied = 1.200 on a line worth 1.000.
  --   · And the link row must ACCUMULATE. ON CONFLICT DO NOTHING dropped the new row while step
  --     (4) still set amount_paid to the invoice's full magnitude, so amount_paid = Σ
  --     amount_applied — the one invariant this system rests on — quietly stopped holding, and the
  --     next unlink would recompute the invoice back down and reopen a paid bill.
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.bank_transactions VALUES (tx, u, -1000, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (c, u, 'incoming', 'received', 'factuur', 600, 200),
         (d, u, 'incoming', 'received', 'factuur', 600, 0);
  INSERT INTO public.bank_tx_invoices (user_id, transaction_id, invoice_id, amount_applied)
  VALUES (u, tx, c, 200);

  -- The line has EUR 800 left and these two still owe EUR 1.000. It does not fit.
  PERFORM public.t_is('a batch needing more than the line has left is refused',
    public.t_batch_refuses(u, tx, ARRAY[c, d])::text, 'true');
  PERFORM public.t_eq('and the line still carries only its 200',
    (SELECT sum(amount_applied) FROM public.bank_tx_invoices WHERE transaction_id = tx), 200);

  -- On a EUR 1.200 line it fits exactly: 1.200 - 200 already spent = the 400 + 600 still owed.
  UPDATE public.bank_transactions SET amount = -1200 WHERE id = tx;
  PERFORM public.book_bank_batch(u, tx, ARRAY[c, d], DATE '2026-08-07');
  PERFORM public.t_eq('the part-paid invoice is settled in full',
    (SELECT amount_paid FROM public.invoices WHERE id = c), 600);
  PERFORM public.t_eq('and its links add up to exactly that — 200 accumulated with 400',
    (SELECT sum(amount_applied) FROM public.bank_tx_invoices WHERE invoice_id = c), 600);
  PERFORM public.t_eq('the whole line is accounted for, once',
    (SELECT sum(amount_applied) FROM public.bank_tx_invoices WHERE transaction_id = tx), 1200);
END $$;

\echo ''
\echo '— [BANK-BATCH-DUBBEL] the same invoice twice is not a batch —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        a uuid := 'aaaaaaaa-0000-0000-0000-00000000000a';
BEGIN
  -- The tie counted A's open balance once per occurrence while the INSERT wrote one row: ARRAY[a, a]
  -- on a EUR 500 invoice tied against a EUR 1.000 line, booked EUR 500, and retired the line with
  -- EUR 500 explained by nothing. De-duplicating makes the tie fail on its own arithmetic.
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.bank_transactions VALUES (tx, u, -1000, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (a, u, 'incoming', 'received', 'factuur', 500, 0);

  PERFORM public.t_is('a doubled id is refused', public.t_batch_refuses(u, tx, ARRAY[a, a])::text, 'true');
  PERFORM public.t_eq('nothing was written', (SELECT count(*) FROM public.bank_tx_invoices), 0);
  PERFORM public.t_is('and the line is untouched',
    (SELECT status FROM public.bank_transactions WHERE id = tx), 'pending');

  -- Listed twice on a line it genuinely ties with once, the de-dup makes it book correctly.
  UPDATE public.bank_transactions SET amount = -500 WHERE id = tx;
  PERFORM public.book_bank_batch(u, tx, ARRAY[a, a], DATE '2026-08-07');
  PERFORM public.t_eq('one link row, one payment',
    (SELECT count(*) FROM public.bank_tx_invoices WHERE transaction_id = tx), 1);
  PERFORM public.t_eq('for the invoice''s own amount',
    (SELECT sum(amount_applied) FROM public.bank_tx_invoices WHERE transaction_id = tx), 500);
END $$;

\echo ''
\echo '— [BANK-BATCH] the refusals, and the empty result that is not one —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        c uuid := 'cccccccc-0000-0000-0000-00000000000c';
        d uuid := 'dddddddd-0000-0000-0000-00000000000d';
BEGIN
  -- A line another booking already claimed returns EMPTY, not an error: the caller reads that as
  -- "skip", and a raise there would look like a broken batch instead of a lost race.
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.bank_transactions VALUES (tx, u, -1000, DATE '2026-08-07', 'matched', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (c, u, 'incoming', 'received', 'factuur', 600, 0),
         (d, u, 'incoming', 'received', 'factuur', 400, 0);
  PERFORM public.t_eq('a claimed line returns no rows, and does not raise',
    (SELECT count(*) FROM public.book_bank_batch(u, tx, ARRAY[c, d], DATE '2026-08-07')), 0);

  -- One unpayable invoice aborts the WHOLE batch — a half-booked tie is worse than none.
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.bank_transactions VALUES (tx, u, -1000, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, accountant_status, invoice_type, total_inc_btw, amount_paid)
  VALUES (c, u, 'incoming', 'received', 'verwerkt', 'factuur', 600, 0),
         (d, u, 'incoming', 'received', NULL,       'factuur', 400, 0);
  PERFORM public.t_is('one verwerkt invoice aborts the batch',
    public.t_batch_refuses(u, tx, ARRAY[c, d])::text, 'true');
  PERFORM public.t_is('the OTHER invoice is untouched too',
    (SELECT status FROM public.invoices WHERE id = d), 'received');

  -- An invoice belonging to someone else is "no longer payable" — the LEFT JOIN scopes on ownership.
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.bank_transactions VALUES (tx, u, -1000, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (c, u, 'incoming', 'received', 'factuur', 600, 0),
         (d, '88888888-8888-8888-8888-888888888888', 'incoming', 'received', 'factuur', 400, 0);
  PERFORM public.t_is('a stranger''s invoice aborts the batch',
    public.t_batch_refuses(u, tx, ARRAY[c, d])::text, 'true');

  -- An empty list is a caller bug, not an empty batch.
  PERFORM public.t_is('no invoices at all is refused',
    public.t_batch_refuses(u, tx, ARRAY[]::uuid[])::text, 'true');
END $$;

\echo ''
\echo '— [BANK-BATCH] the caller guard —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        tx uuid := '22222222-2222-2222-2222-222222222222';
        c uuid := 'cccccccc-0000-0000-0000-00000000000c';
        caught boolean := false;
BEGIN
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.bank_transactions VALUES (tx, u, -600, DATE '2026-08-07', 'pending', NULL);
  INSERT INTO public.invoices (id, receiver_id, direction, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (c, u, 'incoming', 'received', 'factuur', 600, 0);

  EXECUTE $x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
              AS 'SELECT ''99999999-9999-9999-9999-999999999999''::uuid' $x$;
  BEGIN PERFORM public.book_bank_batch(u, tx, ARRAY[c], DATE '2026-08-07');
  EXCEPTION WHEN insufficient_privilege THEN caught := true; END;
  PERFORM public.t_is('a stranger may not book for someone else', caught::text, 'true');
  PERFORM public.t_eq('and nothing was written', (SELECT count(*) FROM public.bank_tx_invoices), 0);

  EXECUTE $x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
              AS 'SELECT NULL::uuid' $x$;
  PERFORM public.book_bank_batch(u, tx, ARRAY[c], DATE '2026-08-07');
  PERFORM public.t_eq('service-role still works — the cron books through it',
    (SELECT amount_paid FROM public.invoices WHERE id = c), 600);
END $$;

\echo ''
\echo '✅ book_bank_batch: every assertion held against a real PostgreSQL.'
