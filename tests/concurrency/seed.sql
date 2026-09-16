-- [GELIJKTIJDIG-VAST] The money shapes both concurrency scenarios contend over.
--
-- Deliberately the smallest arithmetic that makes a lost race visible as a WRONG AMOUNT rather
-- than as a wrong status: one EUR 100 bank line and two EUR 100 invoices. Either invoice alone
-- consumes the whole line, so a second booking that is allowed through is EUR 100 the line never
-- had. The same two invoices serve scenario 2, where the contention is on ONE invoice instead.
--
-- Re-runnable: every scenario run starts from exactly this state, so a run can never inherit the
-- allocations of the previous one and read them as its own.

TRUNCATE public.bank_tx_invoices, public.bank_transactions, public.invoices CASCADE;

INSERT INTO public.invoices (id, sender_id, direction, status, invoice_type, invoice_number,
                             invoice_date, total_ex_btw, btw_amount, total_inc_btw, amount_paid)
VALUES ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
        'outgoing', 'sent', 'factuur', 'CONC-1', current_date, 100, 0, 100, 0),
       ('a0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
        'outgoing', 'sent', 'factuur', 'CONC-2', current_date, 100, 0, 100, 0);

INSERT INTO public.bank_transactions (id, user_id, amount, date, status)
VALUES ('b0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
        100, current_date, 'pending');

-- The rendezvous the driver uses to hold connection A's transaction open. A writes through the
-- real door, then polls this table INSIDE its still-open transaction; the driver inserts the row
-- only once it has SEEN connection B waiting on a lock. So the handoff is a state change, never a
-- duration — see the [GELIJKTIJDIG-VAST] note in scripts/sql-concurrency-test.sh.
DROP TABLE IF EXISTS public.conc_signal;
CREATE TABLE public.conc_signal (name text PRIMARY KEY);

-- Bounded so a future bug can never hang CI: A gives up waiting and commits anyway. Giving up is
-- not a pass — the driver asserts separately that B really did contend, so a run where this
-- timeout fired reports itself as inconclusive instead of green.
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
