-- migrations: invoice_manual_payments.sql, invoice_manual_payment_idempotency_scope.sql, rpc_anon_revoke.sql
-- =====================================================================
-- [SEAM] apply_manual_payment, against a real PostgreSQL.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- ── WHY THIS ONE ──
--
-- This is the function behind every payment nobody observed on a bank statement: the "Al betaald?"
-- button on /vandaag, the pay dialog on the incoming-invoice screen, the cash handover in the
-- kasboek, and the auto-incasso pass in the reconcile cron. Four callers, one contract.
--
-- Its most-used behaviour is also its least visible: a NULL amount means "the whole rest". /vandaag
-- relies on that and names no amount at all — the panel there said "het hele bedrag" while what
-- landed was the remainder, which is how a partly-paid invoice came to be described wrongly on the
-- one screen the owner works from. The write was right; nothing in TypeScript could show that.
--
-- Everything below is asserted against a database that actually runs the function.
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

/** One unpaid EUR 1.000 purchase invoice, owned by u. */
CREATE OR REPLACE FUNCTION public.t_fresh(u uuid, inv uuid, total numeric DEFAULT 1000, paid numeric DEFAULT 0)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'received', 'factuur', total, paid);
END $$;

\echo ''
\echo '— [MANUAL-PARTIAL-PAY] an absent amount means THE REST, not the total —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        r record;
BEGIN
  -- EUR 1.000 invoice with EUR 400 already settled. This is the /vandaag case: the button sends no
  -- amount, and what it must book is the EUR 600 remainder.
  PERFORM public.t_fresh(u, inv, 1000, 400);
  SELECT * INTO r FROM public.apply_manual_payment(
    u, inv, NULL, DATE '2026-08-07', 'bank', ARRAY['received','sent','overdue'], NULL);
  PERFORM public.t_eq('a NULL amount books the remainder', r.applied, 600);
  PERFORM public.t_eq('and the invoice is then fully paid', r.amount_paid, 1000);
  PERFORM public.t_is('so its status flips', r.is_paid::text, 'true');
  PERFORM public.t_is('…in the row too',
    (SELECT status FROM public.invoices WHERE id = inv), 'paid');
  -- amount_paid = SUM(amount_applied) is THE invariant of this app. The instalment row is what
  -- makes that true after any later unlink, so it may never be skipped.
  PERFORM public.t_eq('the instalment is recorded as its own row',
    (SELECT sum(amount_applied) FROM public.bank_tx_invoices WHERE invoice_id = inv), 600);
  PERFORM public.t_is('with no transaction — a manual payment belongs to no bank line',
    (SELECT count(*)::text FROM public.bank_tx_invoices WHERE transaction_id IS NULL), '1');
  PERFORM public.t_is('and its own date, so a kasstelsel quarter can place it',
    (SELECT paid_on::text FROM public.bank_tx_invoices WHERE invoice_id = inv), '2026-08-07');
END $$;

\echo ''
\echo '— [MANUAL-PARTIAL-PAY] instalments accumulate; they do not replace each other —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        r record;
BEGIN
  PERFORM public.t_fresh(u, inv, 1000, 0);
  SELECT * INTO r FROM public.apply_manual_payment(u, inv, 300, DATE '2026-06-01', 'bank', NULL, NULL);
  PERFORM public.t_eq('first instalment', r.applied, 300);
  PERFORM public.t_is('not paid yet', r.is_paid::text, 'false');
  PERFORM public.t_is('and its status is untouched — there is no "partial" status in this app',
    (SELECT status FROM public.invoices WHERE id = inv), 'received');

  SELECT * INTO r FROM public.apply_manual_payment(u, inv, 300, DATE '2026-07-01', 'kas', NULL, NULL);
  PERFORM public.t_eq('second instalment adds up', r.amount_paid, 600);

  -- TWO rows, both with transaction_id NULL. Under a composite primary key on
  -- (transaction_id, invoice_id) this would be impossible — see the note in fixture.sql.
  PERFORM public.t_eq('two separate instalment rows',
    (SELECT count(*) FROM public.bank_tx_invoices WHERE invoice_id = inv), 2);
  PERFORM public.t_is('each keeping its own date',
    (SELECT string_agg(paid_on::text, ',' ORDER BY paid_on) FROM public.bank_tx_invoices), '2026-06-01,2026-07-01');
  PERFORM public.t_is('and its own method, so the kasboek knows which left the till',
    (SELECT string_agg(method, ',' ORDER BY paid_on) FROM public.bank_tx_invoices), 'bank,kas');

  -- The first instalment stamps payment_date; a later one must not move it.
  PERFORM public.t_is('payment_date is the FIRST instalment, not the latest',
    (SELECT payment_date::text FROM public.invoices WHERE id = inv), '2026-06-01');
END $$;

\echo ''
\echo '— [MANUAL-PARTIAL-PAY] an over-payment is clamped, never booked —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        r record;
BEGIN
  PERFORM public.t_fresh(u, inv, 1000, 900);
  SELECT * INTO r FROM public.apply_manual_payment(u, inv, 5000, DATE '2026-08-07', 'bank', NULL, NULL);
  PERFORM public.t_eq('only the remaining 100 is applied', r.applied, 100);
  PERFORM public.t_eq('amount_paid lands exactly on the total, never above it', r.amount_paid, 1000);
  PERFORM public.t_eq('and the link row carries the clamped amount',
    (SELECT sum(amount_applied) FROM public.bank_tx_invoices), 100);
END $$;

\echo ''
\echo '— [MANUAL-PARTIAL-PAY] the same booking twice is ONE booking —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        k uuid := '77777777-7777-7777-7777-777777777777';
        r record;
BEGIN
  -- A double tap, or a POST the browser retried. LEAST() clamps an over-payment but does NOT
  -- deduplicate, so without the client key the instalment lands twice and the owner's books say
  -- EUR 600 left an account that gave EUR 300.
  PERFORM public.t_fresh(u, inv, 1000, 0);
  SELECT * INTO r FROM public.apply_manual_payment(u, inv, 300, DATE '2026-08-07', 'bank', NULL, k);
  PERFORM public.t_eq('the first call books', r.applied, 300);
  PERFORM public.t_is('and is not a duplicate', r.duplicate::text, 'false');

  SELECT * INTO r FROM public.apply_manual_payment(u, inv, 300, DATE '2026-08-07', 'bank', NULL, k);
  PERFORM public.t_is('the second call SAYS it is a duplicate', r.duplicate::text, 'true');
  PERFORM public.t_eq('…and reports the booking that exists', r.applied, 300);
  PERFORM public.t_eq('nothing was written twice',
    (SELECT count(*) FROM public.bank_tx_invoices), 1);
  PERFORM public.t_eq('so amount_paid did not double',
    (SELECT amount_paid FROM public.invoices WHERE id = inv), 300);
END $$;

\echo ''
\echo '— [PAY-KEY-SCOPE] an idempotency key does not open a stranger''s invoice —'
DO $$
DECLARE attacker uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
        victim   uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
        inv_a    uuid := 'aaaaaaaa-1111-1111-1111-111111111111';
        inv_a2   uuid := 'aaaaaaaa-4444-4444-4444-444444444444';
        inv_v    uuid := 'bbbbbbbb-2222-2222-2222-222222222222';
        k        uuid := 'cccccccc-3333-3333-3333-333333333333';
        r        record;
        caught   boolean;
        -- Plain scalars, not the record: a call that RAISES leaves a record unassigned, and
        -- reading one is itself an error. These stay NULL, which is what "nothing came back" is.
        leak_total numeric;
        leak_paid  numeric;
BEGIN
  -- The threat model is the one the caller guard below was written for: SECURITY DEFINER, GRANT
  -- authenticated, PostgREST at /rest/v1/rpc/ with the anon key that ships in the browser bundle.
  -- The attacker here is a perfectly ordinary logged-in user acting AS THEMSELVES — p_user_id is
  -- their own uuid, so the caller guard is satisfied and never enters into it. The only thing
  -- between them and another tenant's figures is the predicate on the read.
  TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices;
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv_a,  attacker, 'received', 'factuur', 100, 0),
         (inv_a2, attacker, 'received', 'factuur', 200, 0),
         (inv_v,  victim,   'received', 'factuur', 8450.75, 3200.50);
  EXECUTE format($x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
                     AS $b$ SELECT %L::uuid $b$ $x$, attacker);

  -- An ordinary booking on their own invoice, with a key they generated themselves.
  PERFORM public.apply_manual_payment(attacker, inv_a, 10, DATE '2026-08-07', 'bank', NULL, k);

  -- The same key, pointed at a stranger's invoice. Before [PAY-KEY-SCOPE] this returned
  -- total=8450.75, amount_paid=3200.50, duplicate=true — reproduced against a real PostgreSQL.
  caught := false;
  BEGIN
    SELECT a.total, a.amount_paid INTO leak_total, leak_paid
    FROM public.apply_manual_payment(
      attacker, inv_v, 10, DATE '2026-08-07', 'bank', ARRAY['received'], k) a;
  EXCEPTION WHEN sqlstate '55000' THEN caught := true; END;
  PERFORM public.t_is('a key from my own booking does not read someone else''s invoice',
    caught::text, 'true');
  -- Belt and braces: whatever the branch does, the stranger's numbers must not be in the answer.
  -- Asserted on the values, not on the refusal — a future rewrite could return instead of raise,
  -- and this line would still be the thing that matters.
  PERFORM public.t_is('and no figure of theirs came back',
    (coalesce(leak_total, 0) = 8450.75 OR coalesce(leak_paid, 0) = 3200.50)::text, 'false');
  PERFORM public.t_eq('nor was anything written on their invoice',
    (SELECT count(*) FROM public.bank_tx_invoices WHERE invoice_id = inv_v), 0);
  PERFORM public.t_eq('nor did their balance move',
    (SELECT amount_paid FROM public.invoices WHERE id = inv_v), 3200.50);

  -- The same key on ANOTHER of the attacker's own invoices is not a replay either — that key is
  -- already spent on other money. It is refused by name rather than falling through to a bare
  -- 23505 from the partial unique index, which is what the caller would otherwise have to read.
  caught := false;
  BEGIN PERFORM public.apply_manual_payment(attacker, inv_a2, 10, DATE '2026-08-07', 'bank', NULL, k);
  EXCEPTION WHEN sqlstate '55000' THEN caught := true; END;
  PERFORM public.t_is('a key already spent on another booking is refused', caught::text, 'true');
  PERFORM public.t_eq('and the second invoice stayed untouched',
    (SELECT amount_paid FROM public.invoices WHERE id = inv_a2), 0);

  -- A genuine replay — same key, same caller, same invoice — still costs nothing and still answers.
  SELECT * INTO r FROM public.apply_manual_payment(attacker, inv_a, 10, DATE '2026-08-07', 'bank', NULL, k);
  PERFORM public.t_is('the real replay still reports itself as one', r.duplicate::text, 'true');
  PERFORM public.t_eq('…with the booking that exists', r.applied, 10);
  PERFORM public.t_eq('…and the invoice''s own total', r.total, 100);
  PERFORM public.t_eq('and still nothing was written twice',
    (SELECT count(*) FROM public.bank_tx_invoices), 1);

  -- A replay whose invoice the caller no longer owns is a question, not a duplicate. Seeded
  -- directly because no code path produces it — ownership can change under a stored key, and the
  -- honest answer is a refusal, not zeros dressed up as a booking.
  UPDATE public.invoices SET receiver_id = victim WHERE id = inv_a;
  caught := false;
  BEGIN PERFORM public.apply_manual_payment(attacker, inv_a, 10, DATE '2026-08-07', 'bank', NULL, k);
  EXCEPTION WHEN sqlstate '55000' THEN caught := true; END;
  PERFORM public.t_is('a replay on an invoice that is no longer mine is refused', caught::text, 'true');

  EXECUTE $x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
              AS 'SELECT NULL::uuid' $x$;
END $$;

\echo ''
\echo '— [MANUAL-PARTIAL-PAY] what it refuses —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        caught boolean;
BEGIN
  -- An invoice the accountant has processed is closed to new money.
  PERFORM public.t_fresh(u, inv, 1000, 0);
  UPDATE public.invoices SET accountant_status = 'verwerkt' WHERE id = inv;
  caught := false;
  BEGIN PERFORM public.apply_manual_payment(u, inv, 100, DATE '2026-08-07', 'bank', NULL, NULL);
  EXCEPTION WHEN sqlstate '55000' THEN caught := true; END;
  PERFORM public.t_is('an invoice locked by the accountant', caught::text, 'true');

  -- A status the caller did not list as payable. The route checks it too; the race is real (another
  -- tab, the accountant, the auto-booker), so the function re-checks it under its own lock.
  PERFORM public.t_fresh(u, inv, 1000, 0);
  UPDATE public.invoices SET status = 'draft' WHERE id = inv;
  caught := false;
  BEGIN PERFORM public.apply_manual_payment(u, inv, 100, DATE '2026-08-07', 'bank', ARRAY['received'], NULL);
  EXCEPTION WHEN sqlstate '55000' THEN caught := true; END;
  PERFORM public.t_is('a status the caller did not call payable', caught::text, 'true');

  -- Already fully paid.
  PERFORM public.t_fresh(u, inv, 1000, 1000);
  UPDATE public.invoices SET status = 'paid' WHERE id = inv;
  caught := false;
  BEGIN PERFORM public.apply_manual_payment(u, inv, 100, DATE '2026-08-07', 'bank', NULL, NULL);
  EXCEPTION WHEN sqlstate '55000' THEN caught := true; END;
  PERFORM public.t_is('an invoice that is already paid', caught::text, 'true');

  -- An invoice that is not this user's. The predicate is on the ARGUMENT, which is why the caller
  -- guard below exists at all.
  PERFORM public.t_fresh(u, inv, 1000, 0);
  caught := false;
  BEGIN PERFORM public.apply_manual_payment(
    '88888888-8888-8888-8888-888888888888', inv, 100, DATE '2026-08-07', 'bank', NULL, NULL);
  EXCEPTION WHEN sqlstate '55000' THEN caught := true; END;
  PERFORM public.t_is('an invoice owned by someone else', caught::text, 'true');

  -- A method that is neither bank nor kas, a missing date, a zero or negative amount.
  PERFORM public.t_fresh(u, inv, 1000, 0);
  caught := false;
  BEGIN PERFORM public.apply_manual_payment(u, inv, 100, DATE '2026-08-07', 'bitcoin', NULL, NULL);
  EXCEPTION WHEN sqlstate '22023' THEN caught := true; END;
  PERFORM public.t_is('a payment method this app does not have', caught::text, 'true');

  caught := false;
  BEGIN PERFORM public.apply_manual_payment(u, inv, 100, NULL, 'bank', NULL, NULL);
  EXCEPTION WHEN sqlstate '22023' THEN caught := true; END;
  PERFORM public.t_is('a payment with no date', caught::text, 'true');

  caught := false;
  BEGIN PERFORM public.apply_manual_payment(u, inv, 0, DATE '2026-08-07', 'bank', NULL, NULL);
  EXCEPTION WHEN sqlstate '22023' THEN caught := true; END;
  PERFORM public.t_is('a payment of nothing', caught::text, 'true');

  PERFORM public.t_eq('and not one of them wrote anything',
    (SELECT count(*) FROM public.bank_tx_invoices), 0);
  PERFORM public.t_eq('nor moved amount_paid',
    (SELECT amount_paid FROM public.invoices WHERE id = inv), 0);
END $$;

\echo ''
\echo '— [MANUAL-PARTIAL-PAY] a creditnota settles by its MAGNITUDE —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        cn uuid := '44444444-4444-4444-4444-444444444444';
        r record;
BEGIN
  -- Stored negative (that is [CREDIT-SIGN]); the function takes abs() of the total, so "settled in
  -- full" means EUR 150 of a EUR -150 credit. Same convention as bank_tx_invoices.amount_applied,
  -- which is a magnitude per invoice — the sign is derived where a budget is computed, never here.
  PERFORM public.t_fresh(u, cn, -150, 0);
  UPDATE public.invoices SET invoice_type = 'creditnota' WHERE id = cn;
  SELECT * INTO r FROM public.apply_manual_payment(u, cn, NULL, DATE '2026-08-07', 'bank', NULL, NULL);
  PERFORM public.t_eq('the credit settles by its magnitude', r.applied, 150);
  PERFORM public.t_is('and is then paid', r.is_paid::text, 'true');
  PERFORM public.t_eq('the link row is positive too',
    (SELECT sum(amount_applied) FROM public.bank_tx_invoices), 150);
END $$;

\echo ''
\echo '— [MANUAL-PARTIAL-PAY] the caller guard —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        inv uuid := '33333333-3333-3333-3333-333333333333';
        caught boolean := false;
BEGIN
  PERFORM public.t_fresh(u, inv, 1000, 0);

  -- SECURITY DEFINER + GRANT authenticated + PostgREST at /rest/v1/rpc/ with the anon key that
  -- ships in the browser bundle. Without this guard any registered user could book a payment on a
  -- stranger's invoice by naming their uuid.
  EXECUTE $x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
              AS 'SELECT ''99999999-9999-9999-9999-999999999999''::uuid' $x$;
  BEGIN PERFORM public.apply_manual_payment(u, inv, 100, DATE '2026-08-07', 'bank', NULL, NULL);
  EXCEPTION WHEN insufficient_privilege THEN caught := true; END;
  PERFORM public.t_is('a stranger may not book for someone else', caught::text, 'true');
  PERFORM public.t_eq('and nothing was written', (SELECT count(*) FROM public.bank_tx_invoices), 0);

  -- The owner may.
  EXECUTE format($x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
                     AS $b$ SELECT %L::uuid $b$ $x$, u);
  PERFORM public.apply_manual_payment(u, inv, 100, DATE '2026-08-07', 'bank', NULL, NULL);
  PERFORM public.t_eq('the owner may', (SELECT amount_paid FROM public.invoices WHERE id = inv), 100);

  -- And so may service-role (NULL), which is what the incasso pass in the reconcile cron uses.
  EXECUTE $x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
              AS 'SELECT NULL::uuid' $x$;
  PERFORM public.apply_manual_payment(u, inv, 100, DATE '2026-08-07', 'bank', NULL, NULL);
  PERFORM public.t_eq('and so may service-role', (SELECT amount_paid FROM public.invoices WHERE id = inv), 200);
END $$;

-- ══ [CREDIT-AFHANDELEN] A creditnota settles whole, in abs() space ═══════════════════════════
--
-- The screen's new "Verrekend of terugontvangen?" leans on exactly this: a NEGATIVE invoice,
-- p_amount NULL, abs() magnitude, flip to paid. The block above (— a creditnota settles by its
-- MAGNITUDE —) already proves the happy path; THIS one adds the two edges the button introduces:
-- a closed credit refuses a second close (the double-tap that books a refund twice), and a typed
-- amount clamps to the magnitude (a typo cannot overshoot). Kept with the report's own numbers.
DO $$
DECLARE
  u   uuid := gen_random_uuid();
  inv uuid := gen_random_uuid();
  r   record;
BEGIN
  PERFORM set_config('test.uid', u::text, true);
  INSERT INTO public.profiles (id, role) VALUES (u, 'zzper');
  -- The row from the report: an incoming creditnota, stored NEGATIVE, still 'received'.
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'received', 'creditnota', -51.80, 0);

  -- NULL amount = close it whole. The magnitude settles; the status flips.
  SELECT * INTO r FROM public.apply_manual_payment(u, inv, NULL, DATE '2026-08-22', 'bank', ARRAY['received'], gen_random_uuid());
  PERFORM public.t_eq('[CREDIT] the whole magnitude settles', r.applied, 51.80);
  PERFORM public.t_eq('[CREDIT] amount_paid is the magnitude', r.amount_paid, 51.80);
  IF NOT r.is_paid THEN
    RAISE EXCEPTION '[CREDIT] the creditnota did not flip to paid';
  END IF;
  IF (SELECT status FROM public.invoices WHERE id = inv) <> 'paid' THEN
    RAISE EXCEPTION '[CREDIT] status on the row disagrees with the function''s answer';
  END IF;

  -- The instalment row is a MAGNITUDE — the convention every reader flips at read time
  -- (allocate_bank_payment.sql:215, [CASH-CREDITNOTA] in cash.ts). A signed row here would make
  -- recompute_invoice_amount_paid produce a negative amount_paid and split the two paths.
  PERFORM public.t_eq('[CREDIT] the instalment row carries the magnitude',
    (SELECT amount_applied FROM public.bank_tx_invoices WHERE invoice_id = inv), 51.80);

  -- Closed means closed: a second attempt must refuse, exactly as on a normal invoice.
  BEGIN
    PERFORM public.apply_manual_payment(u, inv, NULL, DATE '2026-08-23', 'bank', ARRAY['received'], gen_random_uuid());
    RAISE EXCEPTION '[CREDIT] a closed creditnota accepted a second settlement';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
END $$;

-- …and a PARTIAL amount on a credit still clamps to the magnitude, so a typo cannot overshoot.
DO $$
DECLARE
  u   uuid := gen_random_uuid();
  inv uuid := gen_random_uuid();
  r   record;
BEGIN
  PERFORM set_config('test.uid', u::text, true);
  INSERT INTO public.profiles (id, role) VALUES (u, 'zzper');
  INSERT INTO public.invoices (id, receiver_id, status, invoice_type, total_inc_btw, amount_paid)
  VALUES (inv, u, 'received', 'creditnota', -136.00, 0);
  SELECT * INTO r FROM public.apply_manual_payment(u, inv, 500, DATE '2026-08-22', 'bank', ARRAY['received'], gen_random_uuid());
  PERFORM public.t_eq('[CREDIT] LEAST clamps a too-large amount to the magnitude', r.applied, 136.00);
  IF NOT r.is_paid THEN
    RAISE EXCEPTION '[CREDIT] clamped settlement should still close the credit';
  END IF;
END $$;

\echo ''
\echo '✅ apply_manual_payment: every assertion held against a real PostgreSQL.'
