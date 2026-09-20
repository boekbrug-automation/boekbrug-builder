-- migrations: seed_invoice_counter.sql, rpc_anon_revoke.sql
-- =====================================================================
-- [SEAM] seed_invoice_counter, against a real PostgreSQL.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- factuur_b_numbering.sql is NOT loaded here. It does far more than define the counter — it seeds
-- from public.invoices, adds columns to profiles, and drops a function — none of which this
-- contract depends on. The fixture declares invoice_counters itself, and next_invoice_seq is
-- re-declared below in the two lines this test actually needs from it: the same atomic
-- INSERT … ON CONFLICT DO UPDATE last_seq + 1. Loading the real migration for those two lines
-- would drag in half a schema and make a failure here say nothing about this function.
--
-- WHAT IS BEING HELD. The seeding path read last_seq, took Math.max against it in TypeScript, and
-- wrote the result with an unconditional upsert. An allocation inside that window made the counter
-- go BACKWARDS, and the next invoice reused a sequence — Article 35 Wet OB 1968 wants them
-- sequential, and the UNIQUE constraint only catches a duplicate while both invoices still exist.
-- =====================================================================

\set ON_ERROR_STOP on

-- The allocator, in the two lines this contract interacts with. Deliberately NOT a copy of the
-- whole function: the only thing that matters here is that it bumps the same row atomically.
CREATE OR REPLACE FUNCTION public.next_invoice_seq(p_user_id uuid, p_year int, p_type text)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE v_seq int;
BEGIN
  INSERT INTO public.invoice_counters (user_id, year, type, last_seq)
  VALUES (p_user_id, p_year, p_type, 1)
  ON CONFLICT (user_id, year, type)
  DO UPDATE SET last_seq = public.invoice_counters.last_seq + 1
  RETURNING last_seq INTO v_seq;
  RETURN v_seq;
END $$;

CREATE OR REPLACE FUNCTION public.t_eq(what text, got numeric, want numeric) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL · % — got %, expected %', what, got, want;
  END IF;
  RAISE NOTICE '  ok · % (%)', what, got;
END $$;

\echo ''
\echo '— [FACTUUR-B] a counter only ever moves forward —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  TRUNCATE public.invoice_counters;

  PERFORM public.t_eq('a first seed lands as asked',
    public.seed_invoice_counter(u, 2026, 'factuur', 99), 99);
  PERFORM public.t_eq('so the owner''s first invoice is 100',
    (SELECT last_seq FROM public.invoice_counters WHERE user_id = u) + 1, 100);

  -- The refusal is in the DATA, not in the caller. This is what the application used to decide for
  -- itself with a Math.max against a value it had read moments earlier.
  PERFORM public.t_eq('a LOWER seed does not move it',
    public.seed_invoice_counter(u, 2026, 'factuur', 40), 99);
  PERFORM public.t_eq('and forward still moves',
    public.seed_invoice_counter(u, 2026, 'factuur', 250), 250);
  PERFORM public.t_eq('an equal seed is a no-op, not an error',
    public.seed_invoice_counter(u, 2026, 'factuur', 250), 250);
END $$;

\echo ''
\echo '— [FACTUUR-B] THE RACE: an allocation between the read and the write —'
DO $$
DECLARE u uuid := '22222222-2222-2222-2222-222222222222';
        stale int;
BEGIN
  TRUNCATE public.invoice_counters;
  PERFORM public.seed_invoice_counter(u, 2026, 'factuur', 99);

  -- The route reads the counter…
  SELECT last_seq INTO stale FROM public.invoice_counters WHERE user_id = u;
  PERFORM public.t_eq('the route reads 99', stale, 99);

  -- …and while it is deciding, an invoice is numbered. next_invoice_seq is atomic precisely
  -- because this can happen: two invoices can be sent in the same instant.
  PERFORM public.next_invoice_seq(u, 2026, 'factuur');   -- 100

  -- Now the route writes the maximum it computed from the STALE read. The old code did
  -- `upsert({ last_seq: Math.max(startSeq - 1, stale) })`, an unconditional SET — the counter went
  -- back to 99 and invoice number 100 was handed out a second time.
  PERFORM public.t_eq('the stale seed cannot undo the allocation',
    public.seed_invoice_counter(u, 2026, 'factuur', GREATEST(60, stale)), 100);
  PERFORM public.t_eq('so the next number is 101, never 100 again',
    public.next_invoice_seq(u, 2026, 'factuur'), 101);
END $$;

\echo ''
\echo '— [FACTUUR-B] counters are per user, per year, per type —'
DO $$
DECLARE a uuid := '33333333-3333-3333-3333-333333333333';
        b uuid := '44444444-4444-4444-4444-444444444444';
BEGIN
  TRUNCATE public.invoice_counters;
  PERFORM public.seed_invoice_counter(a, 2026, 'factuur', 500);
  PERFORM public.t_eq('another user is untouched',
    public.seed_invoice_counter(b, 2026, 'factuur', 10), 10);
  PERFORM public.t_eq('another year is its own counter (yearly reset)',
    public.seed_invoice_counter(a, 2027, 'factuur', 0), 0);
  PERFORM public.t_eq('a creditnota numbers separately',
    public.seed_invoice_counter(a, 2026, 'creditnota', 3), 3);
  PERFORM public.t_eq('and the factuur counter never moved',
    (SELECT last_seq FROM public.invoice_counters WHERE user_id = a AND year = 2026 AND type = 'factuur'), 500);
  -- year 0 is the sentinel for continuous numbering — a real key, not a missing one.
  PERFORM public.t_eq('year 0 is continuous numbering, and is allowed',
    public.seed_invoice_counter(a, 0, 'factuur', 77), 77);
END $$;

\echo ''
\echo '— [FACTUUR-B] what it refuses —'
DO $$
DECLARE u uuid := '55555555-5555-5555-5555-555555555555';
        caught boolean;
BEGIN
  TRUNCATE public.invoice_counters;

  caught := false;
  BEGIN PERFORM public.seed_invoice_counter(u, 2026, 'offerte', 1);
  EXCEPTION WHEN sqlstate '22023' THEN caught := true; END;
  PERFORM public.t_eq('an unknown invoice type is refused', caught::int, 1);

  -- A counter counts documents that exist. Negative is not a smaller start, it is nonsense, and it
  -- would make the next allocation return zero or below.
  caught := false;
  BEGIN PERFORM public.seed_invoice_counter(u, 2026, 'factuur', -5);
  EXCEPTION WHEN sqlstate '22023' THEN caught := true; END;
  PERFORM public.t_eq('a negative counter is refused', caught::int, 1);

  caught := false;
  BEGIN PERFORM public.seed_invoice_counter(u, 2026, 'factuur', NULL);
  EXCEPTION WHEN sqlstate '22023' THEN caught := true; END;
  PERFORM public.t_eq('and so is a missing one', caught::int, 1);

  PERFORM public.t_eq('nothing was written by any of them',
    (SELECT count(*) FROM public.invoice_counters), 0);

  -- Starting at 1 means last_seq 0, which is a legitimate seed and must not be caught by the
  -- negative guard.
  PERFORM public.t_eq('zero IS allowed — it means "start at 1"',
    public.seed_invoice_counter(u, 2026, 'factuur', 0), 0);
END $$;

\echo ''
\echo '— [FACTUUR-B] the caller guard —'
DO $$
DECLARE u uuid := '66666666-6666-6666-6666-666666666666';
        caught boolean := false;
BEGIN
  TRUNCATE public.invoice_counters;

  -- Impersonate a logged-in stranger. This function is SECURITY DEFINER and GRANTed to
  -- `authenticated`, and PostgREST exposes it at /rest/v1/rpc/ with the anon key that ships in the
  -- browser bundle — so without the guard any registered user could jump a stranger's numbering.
  EXECUTE $x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
              AS 'SELECT ''99999999-9999-9999-9999-999999999999''::uuid' $x$;
  BEGIN PERFORM public.seed_invoice_counter(u, 2026, 'factuur', 9000);
  EXCEPTION WHEN insufficient_privilege THEN caught := true; END;
  PERFORM public.t_eq('a stranger may not seed someone else''s counter', caught::int, 1);
  PERFORM public.t_eq('and nothing was written', (SELECT count(*) FROM public.invoice_counters), 0);

  -- The owner themselves may.
  -- The body is dollar-quoted: %L renders its own single quotes, which would close a '…' body.
  EXECUTE format($x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
                     AS $b$ SELECT %L::uuid $b$ $x$, u);
  PERFORM public.t_eq('the owner may', public.seed_invoice_counter(u, 2026, 'factuur', 12), 12);

  -- And service-role (NULL) may, which is what /api/invoice/numbering actually uses: the counter
  -- table has no write policy for the session client at all.
  EXECUTE $x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
              AS 'SELECT NULL::uuid' $x$;
  PERFORM public.t_eq('and so may service-role', public.seed_invoice_counter(u, 2026, 'factuur', 20), 20);
END $$;

\echo ''
\echo '✅ seed_invoice_counter: every assertion held against a real PostgreSQL.'
