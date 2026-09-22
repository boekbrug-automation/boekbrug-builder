-- [KANTOORGIDS-BEWIJS] The world both directory concurrency scenarios contend over.
--
-- Deliberately the smallest shape that makes a lost race visible as a WRONG PUBLIC STATE rather
-- than as a wrong count: one office, two clients, one published listing. Either delete alone
-- leaves a link standing, so the listing must survive it; together they leave none, so the listing
-- must come down. A trigger that reads its own snapshot instead of serializing gets the first half
-- right and the second half wrong, which is exactly the failure being hunted.
--
-- Re-runnable: every scenario run starts from exactly this state, so a run can never inherit the
-- state of the previous one and read it as its own.

TRUNCATE public.accountant_directory, public.accountant_clients CASCADE;
DELETE FROM public.profiles WHERE id IN (
  '0a000000-0000-4000-8000-00000000000a',
  '0c000000-0000-4000-8000-00000000000c',
  '0d000000-0000-4000-8000-00000000000d'
);

INSERT INTO public.profiles (id, role) VALUES
  ('0a000000-0000-4000-8000-00000000000a', 'accountant'),  -- A, the office
  ('0c000000-0000-4000-8000-00000000000c', 'zzper'),       -- C, client one
  ('0d000000-0000-4000-8000-00000000000d', 'zzper');       -- D, client two

INSERT INTO public.accountant_clients (accountant_id, zzper_id) VALUES
  ('0a000000-0000-4000-8000-00000000000a', '0c000000-0000-4000-8000-00000000000c'),
  ('0a000000-0000-4000-8000-00000000000a', '0d000000-0000-4000-8000-00000000000d');

-- Written as the table owner, so RLS does not apply and the seed states the world directly. The
-- BEFORE trigger still fires and still finds the two links above, which is the correct answer.
INSERT INTO public.accountant_directory
  (accountant_id, office_name, city, contact_email, languages, published)
VALUES
  ('0a000000-0000-4000-8000-00000000000a', 'Kantoor A', 'Utrecht', 'a@a.nl', ARRAY['nl'], true);

-- The same rendezvous the money scenarios use: connection A holds its transaction open inside
-- conc_wait_for_go() while the driver observes, from a third connection, that B is really blocked.
-- See the [GELIJKTIJDIG-VAST] note in scripts/sql-concurrency-test.sh — the handoff is a state
-- change the driver SEES, never a duration it hopes for.
DROP TABLE IF EXISTS public.conc_signal;
CREATE TABLE public.conc_signal (name text PRIMARY KEY);

CREATE OR REPLACE FUNCTION public.conc_wait_for_go() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE tries int := 0;
BEGIN
  WHILE tries < 600 LOOP
    IF EXISTS (SELECT 1 FROM public.conc_signal WHERE name = 'go') THEN RETURN; END IF;
    PERFORM pg_sleep(0.05);
    tries := tries + 1;
  END LOOP;
END $$;
