-- migrations: factuur_b_numbering.sql, rpc_anon_revoke.sql
-- =====================================================================
-- [SEAM] next_invoice_seq, against a real PostgreSQL — including two real sessions.
-- Run: npm run test:sql   (see scripts/sql-seam-test.sh)
-- =====================================================================
-- ── WHY THIS ONE ──
--
-- This is the function that mints a legal invoice number. Article 35 Wet OB 1968 wants a
-- sequential, gapless, forward-only series, and every guarantee behind that lives in ONE statement
-- inside this function. It had no seam test at all: seed_invoice_counter, its much smaller sibling,
-- has had one for months, while the allocator itself was only ever exercised against a hand-copied
-- stub in TypeScript — which cannot fail the way a database fails.
--
-- The claim that most needs a real database is the one a stub cannot make. Its own comment says it:
--
--     Concurrent callers serialize on the row lock taken by ON CONFLICT -- each gets a distinct
--     last_seq. No SELECT-then-compute window.
--
-- Every other test in tests/sql/ runs in a single psql session, so no file in this suite has ever
-- driven two callers at once — the gap behind every TOCTOU finding in this audit. dblink opens a
-- second REAL connection from inside the test, so the block below is two sessions contending for
-- one row, with a real lock and a real commit between them. Not a simulation of the race: the race.
--
-- dblink ships with postgresql-contrib and is present in the postgres:16 image CI uses. If it is
-- missing this file FAILS rather than skipping — a concurrency proof that quietly did not run is
-- worse than none, because the suite still reports green.
-- =====================================================================

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

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

/** Speak as this user. The function's caller guard reads auth.uid(); NULL is service-role. */
CREATE OR REPLACE FUNCTION public.t_as(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF u IS NULL THEN
    EXECUTE $x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
                AS 'SELECT NULL::uuid' $x$;
  ELSE
    EXECUTE format($x$ CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
                       AS $b$ SELECT %L::uuid $b$ $x$, u);
  END IF;
END $$;

\echo ''
\echo '— [FACTUUR-B] the first number is 1, and every next one is the next —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  TRUNCATE public.invoice_counters;
  PERFORM public.t_as(u);
  -- No row yet: the INSERT branch. An owner's very first invoice must be 1, not 0 and not 2.
  PERFORM public.t_eq('the first invoice of the year', public.next_invoice_seq(u, 2026, 'factuur'), 1);
  PERFORM public.t_eq('the second', public.next_invoice_seq(u, 2026, 'factuur'), 2);
  PERFORM public.t_eq('the third', public.next_invoice_seq(u, 2026, 'factuur'), 3);
  PERFORM public.t_eq('and the counter row agrees',
    (SELECT last_seq FROM public.invoice_counters WHERE user_id = u AND year = 2026 AND type = 'factuur'), 3);
  PERFORM public.t_eq('one row, not three',
    (SELECT count(*) FROM public.invoice_counters), 1);
END $$;

\echo ''
\echo '— [NUMMER-JAAR] a new year is a new series, and the old one is untouched —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  -- The cross-year case, which nothing tested on any surface. The lock and the allocator disagreed
  -- about which YEAR they were talking about ([NUMMER-JAAR]/[NUMMER-SLOT] in numbering-lock.ts);
  -- this is the half of that story the database owns.
  TRUNCATE public.invoice_counters;
  PERFORM public.t_as(u);
  PERFORM public.next_invoice_seq(u, 2026, 'factuur');
  PERFORM public.next_invoice_seq(u, 2026, 'factuur');
  PERFORM public.t_eq('2026 stands at 2', public.next_invoice_seq(u, 2026, 'factuur'), 3);

  PERFORM public.t_eq('…and 2027 starts at 1, not at 4',
    public.next_invoice_seq(u, 2027, 'factuur'), 1);
  PERFORM public.t_eq('the 2026 counter did not move',
    (SELECT last_seq FROM public.invoice_counters WHERE user_id = u AND year = 2026 AND type = 'factuur'), 3);

  -- Numbering an invoice in the OLD year after the new one has started is legitimate (a December
  -- invoice finished in January), and it must continue the old series, not restart it.
  PERFORM public.t_eq('a late 2026 invoice continues 2026', public.next_invoice_seq(u, 2026, 'factuur'), 4);
  PERFORM public.t_eq('…and 2027 is still where it was',
    (SELECT last_seq FROM public.invoice_counters WHERE user_id = u AND year = 2027 AND type = 'factuur'), 1);
END $$;

\echo ''
\echo '— [FACTUUR-B] every (user × year × type) is its own run —'
DO $$
DECLARE u1 uuid := '11111111-1111-1111-1111-111111111111';
        u2 uuid := '22222222-2222-2222-2222-222222222222';
BEGIN
  TRUNCATE public.invoice_counters;
  PERFORM public.t_as(u1);
  PERFORM public.next_invoice_seq(u1, 2026, 'factuur');
  PERFORM public.next_invoice_seq(u1, 2026, 'factuur');

  -- A creditnota has its own series (CR-…), so it may not consume a factuur number.
  PERFORM public.t_eq('creditnota starts at 1 beside a factuur at 2',
    public.next_invoice_seq(u1, 2026, 'creditnota'), 1);
  PERFORM public.t_eq('and pro_forma too', public.next_invoice_seq(u1, 2026, 'pro_forma'), 1);
  PERFORM public.t_eq('the factuur run is unaffected',
    public.next_invoice_seq(u1, 2026, 'factuur'), 3);

  -- year = 0 is the CONTINUOUS sentinel: an owner whose template has no {year} never resets.
  PERFORM public.t_eq('the continuous counter is its own row', public.next_invoice_seq(u1, 0, 'factuur'), 1);

  -- And another owner shares nothing at all.
  PERFORM public.t_as(u2);
  PERFORM public.t_eq('a second owner starts at 1', public.next_invoice_seq(u2, 2026, 'factuur'), 1);
  PERFORM public.t_eq('four rows for the first owner, one for the second',
    (SELECT count(*) FROM public.invoice_counters), 5);
END $$;

\echo ''
\echo '— [FACTUUR-B] the caller guard: a number is minted BY its owner, never for them —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        caught boolean;
BEGIN
  TRUNCATE public.invoice_counters;

  -- SECURITY DEFINER + GRANT authenticated + PostgREST /rest/v1/rpc/ with the browser's anon key.
  -- Without this guard any registered user could burn numbers out of a stranger's legal sequence
  -- by naming their uuid — an Article 35 gap that nothing could repair afterwards.
  PERFORM public.t_as('99999999-9999-9999-9999-999999999999');
  caught := false;
  BEGIN PERFORM public.next_invoice_seq(u, 2026, 'factuur');
  EXCEPTION WHEN insufficient_privilege THEN caught := true; END;
  PERFORM public.t_is('a stranger may not allocate for someone else', caught::text, 'true');

  -- Unlike the payment functions, service-role may NOT mint either: both real call sites use the
  -- authenticated session client, and a number minted with no caller has nobody to attribute it to.
  PERFORM public.t_as(NULL);
  caught := false;
  BEGIN PERFORM public.next_invoice_seq(u, 2026, 'factuur');
  EXCEPTION WHEN insufficient_privilege THEN caught := true; END;
  PERFORM public.t_is('and neither may service-role', caught::text, 'true');

  PERFORM public.t_eq('not one of them burned a number',
    (SELECT coalesce(sum(last_seq), 0) FROM public.invoice_counters), 0);

  -- The owner may.
  PERFORM public.t_as(u);
  PERFORM public.t_eq('the owner may', public.next_invoice_seq(u, 2026, 'factuur'), 1);
END $$;

\echo ''
\echo '— [FACTUUR-B] what it refuses before touching a counter —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        caught boolean;
BEGIN
  TRUNCATE public.invoice_counters;
  PERFORM public.t_as(u);

  -- A type outside the three would open a FOURTH series under the same BTW number.
  caught := false;
  BEGIN PERFORM public.next_invoice_seq(u, 2026, 'offerte');
  EXCEPTION WHEN sqlstate '22023' THEN caught := true; END;
  PERFORM public.t_is('a type this app does not number', caught::text, 'true');

  -- A negative year is not a year; 0 is the continuous sentinel and must stay legal.
  caught := false;
  BEGIN PERFORM public.next_invoice_seq(u, -1, 'factuur');
  EXCEPTION WHEN sqlstate '22023' THEN caught := true; END;
  PERFORM public.t_is('a negative year', caught::text, 'true');
  PERFORM public.t_eq('but 0 is the continuous sentinel, not an error',
    public.next_invoice_seq(u, 0, 'factuur'), 1);

  PERFORM public.t_eq('and the refusals wrote nothing',
    (SELECT count(*) FROM public.invoice_counters WHERE year <> 0), 0);
END $$;

\echo ''
\echo '— [FACTUUR-B] forward-only: a seeded counter is never walked back —'
DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  TRUNCATE public.invoice_counters;
  PERFORM public.t_as(u);
  -- The onboarding seed: "my next invoice is 46". seed_invoice_counter stores 45.
  INSERT INTO public.invoice_counters (user_id, year, type, last_seq) VALUES (u, 2026, 'factuur', 45);
  PERFORM public.t_eq('the next number is 46, not 1', public.next_invoice_seq(u, 2026, 'factuur'), 46);
  PERFORM public.t_eq('and it keeps going', public.next_invoice_seq(u, 2026, 'factuur'), 47);
END $$;

\echo ''
\echo '— [FACTUUR-B] TWO REAL SESSIONS on one counter: the row lock, not a simulation —'

-- The setup runs OUTSIDE the DO block, and that is not a style choice. TRUNCATE takes an ACCESS
-- EXCLUSIVE lock held until its transaction commits, and a DO block is one transaction — so a
-- TRUNCATE inside the block below would still be holding that lock while this session waits for a
-- dblink backend that is itself waiting for it. Written that way the first time, it deadlocked
-- exactly as it should have. Out here each statement commits on its own, and by the time the two
-- sessions open, this one holds nothing.
--
-- The counter is SEEDED, and that is the whole experiment. Starting from an empty table proves
-- nothing: both callers then take the INSERT branch and the UNIQUE index serialises them however
-- the function is written. A negative control showed exactly that — a deliberately non-atomic
-- SELECT-then-compute allocator passed the first version of this block. From an EXISTING counter
-- the two implementations part company:
--
--   atomic      A's ON CONFLICT DO UPDATE locks the row; B waits; B gets 43.
--   non-atomic  A SELECTs 41 (no lock) and UPDATEs to 42. B SELECTs 41 too — READ COMMITTED sees
--               the last committed value — computes 42, and its UPDATE waits. When A commits, B
--               writes 42 as well. TWO INVOICES, ONE NUMBER, and no error anywhere.
--
-- The second is the bug this function's single statement exists to prevent, and it is the shape
-- Article 35 cannot survive: two documents carrying the same number, discovered by an auditor.
TRUNCATE public.invoice_counters;
INSERT INTO public.invoice_counters (user_id, year, type, last_seq)
VALUES ('11111111-1111-1111-1111-111111111111', 2026, 'factuur', 41);
SELECT public.t_as('11111111-1111-1111-1111-111111111111');

DO $$
DECLARE u uuid := '11111111-1111-1111-1111-111111111111';
        conn text := 'dbname=' || current_database();
        a_seq int;
        b_seq int;
        b_early int;
        blocked boolean;
        sqlstate_seen text;
BEGIN
  -- Two independent connections. Everything below happens in THEM, not here: real backends, real
  -- transactions, one real row lock. This is the claim the function's own comment makes and that
  -- nothing in this repository had ever exercised — every other file in tests/sql/ is one session.
  PERFORM dblink_connect('sess_a', conn);
  PERFORM dblink_connect('sess_b', conn);

  -- A opens a transaction and takes the next number. Its lock on the counter row is held until it
  -- commits.
  PERFORM dblink_exec('sess_a', 'BEGIN');
  SELECT s INTO a_seq FROM dblink('sess_a',
    'SELECT public.next_invoice_seq(''' || u || ''', 2026, ''factuur'')') AS t(s int);
  PERFORM public.t_eq('A continues the series at 42', a_seq, 42);

  -- B asks for one WHILE A still holds it, with a lock_timeout — and THAT is the whole assertion.
  --
  -- [SLOT-DETERMINISTISCH] This block used to send B's query asynchronously and then poll
  -- pg_stat_activity for `wait_event_type = 'Lock'`, up to sixty times at 50 ms. It was a race
  -- watching a race: the state it looked for exists only WHILE B is parked on the lock, so the
  -- test had to catch a moment rather than establish a fact. Measured on an idle machine it needed
  -- one spin of the sixty — a 60× margin — and CI still lost it once, failing a pull request that
  -- contained no SQL at all. A gate that goes red on unrelated work is one people learn to re-run
  -- without reading, which costs more than the gate is worth.
  --
  -- lock_timeout turns the observation into a guarantee. A holds the counter row and does not
  -- commit until further down, so if the allocator serialises at all then B MUST sit on that lock,
  -- and after 750 ms Postgres cancels it with SQLSTATE 55P03 (lock_not_available). Nothing is
  -- sampled: a slow machine only means B reaches the lock later and is cancelled later. The error
  -- travels back through dblink and PL/pgSQL catches it with its SQLSTATE intact — verified
  -- against a real PostgreSQL 16 before this was written, in both directions.
  --
  -- And the OTHER outcome is the bug this file exists for: an allocator that does not serialise
  -- returns a number here instead of blocking, and it is A's number. That is why b_early is
  -- captured and reported rather than merely counted as "no error".
  PERFORM dblink_exec('sess_b', 'BEGIN');
  PERFORM dblink_exec('sess_b', 'SET lock_timeout = ''750ms''');
  BEGIN
    SELECT s INTO b_early FROM dblink('sess_b',
      'SELECT public.next_invoice_seq(''' || u || ''', 2026, ''factuur'')') AS t(s int);
    blocked := false;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS sqlstate_seen = RETURNED_SQLSTATE;
    blocked := true;
  END;
  -- The number B got is IN the failure message, not merely absent from it. A non-serialising
  -- allocator returns A's own number here, and "got false, expected true" would send the next
  -- reader looking for a lock problem when the evidence is the 42 sitting in b_early.
  PERFORM public.t_is(
    'B is BLOCKED by A''s lock — the two callers really are serialised'
      || CASE WHEN blocked THEN '' ELSE format(' — it returned %s instead of waiting', b_early) END,
    blocked::text, 'true');
  -- The specific cancellation, not any error at all. Without this a typo in the SQL would satisfy
  -- the assertion above and the test would claim serialisation it never saw.
  PERFORM public.t_is('…and blocked is what it was: a lock timeout, not some other failure',
    coalesce(sqlstate_seen, '<none>'), '55P03');
  -- B's transaction is aborted by the cancellation; give it back cleanly before reusing it.
  PERFORM dblink_exec('sess_b', 'ROLLBACK');
  PERFORM dblink_exec('sess_b', 'RESET lock_timeout');
  PERFORM public.t_eq('…and nothing is committed yet, so the counter still reads 41 outside',
    (SELECT last_seq FROM public.invoice_counters WHERE user_id = u AND year = 2026 AND type = 'factuur'), 41);

  -- A commits; the row is free and B asks again — this time it gets a number.
  -- [SLOT-DETERMINISTISCH] Synchronous now. The async pair (dblink_send_query + a
  -- dblink_get_result LOOP, because an empty result is what terminates the batch) existed only so
  -- this session could watch B wait without deadlocking against it, and there is nothing to watch
  -- any more. Its own comment recorded that it had already cost this block one failure.
  PERFORM dblink_exec('sess_a', 'COMMIT');
  PERFORM dblink_exec('sess_b', 'BEGIN');
  SELECT s INTO b_seq FROM dblink('sess_b',
    'SELECT public.next_invoice_seq(''' || u || ''', 2026, ''factuur'')') AS t(s int);
  PERFORM dblink_exec('sess_b', 'COMMIT');

  -- THE assertion. A non-atomic allocator reaches this line with b_seq = 42 = a_seq.
  PERFORM public.t_is('two callers, two DISTINCT numbers', (a_seq <> b_seq)::text, 'true');
  PERFORM public.t_eq('B gets the next one, never A''s', b_seq, 43);
  PERFORM public.t_is('and consecutive — no gap for an auditor to find either',
    (b_seq = a_seq + 1)::text, 'true');
  PERFORM public.t_eq('the counter ends where the two calls left it',
    (SELECT last_seq FROM public.invoice_counters WHERE user_id = u AND year = 2026 AND type = 'factuur'), 43);
  PERFORM public.t_eq('one counter row, not two',
    (SELECT count(*) FROM public.invoice_counters), 1);

  PERFORM dblink_disconnect('sess_a');
  PERFORM dblink_disconnect('sess_b');
END $$;

SELECT '[FACTUUR-B] next_invoice_seq held: the first number is 1, each year and type is its own run, a stranger and service-role are both refused without burning a number, a seed is never walked back, and two REAL concurrent sessions serialise on the row lock and take consecutive numbers' AS result;
